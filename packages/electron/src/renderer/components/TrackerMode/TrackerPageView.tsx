/**
 * A typed page in Pages mode (`tracker://<id>` tab): a markdown document tab
 * like any other, not the tracker detail pane. Top to bottom: the crumb (where
 * the page sits in the Pages tree), the title, one row of the type chip and
 * the single-valued fields, the body editor, and the Links section.
 *
 * The body and field writes go through the same hooks as `TrackerItemDetail`
 * (`useTrackerItemBody`, `useTrackerItemFields`), so local and collaborative
 * bodies load, save and recover exactly as they do in Tracker mode.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { atom, useAtomValue, type Atom } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { NimbalystEditor } from '@nimbalyst/runtime/editor';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { CollabScope } from '@nimbalyst/collab-client/core';
import { NEUTRAL_SWATCH, TYPE_COLORS } from '@nimbalyst/collab-client/trackers-ui';
import { globalRegistry } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { TrackerReferenceSourceProvider } from '@nimbalyst/runtime/plugins/TrackerLinkPlugin';
import { getRecordTitle } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';
import { resolveTrackerWriteAccess } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/trackerLifecycle';
import { TrackerFieldPills } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/TrackerFieldPills';
import { getTrackerTagsField, useTrackerChipFieldSections } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/trackerChipFields';
import { isTrackerFieldEmpty } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/trackerFieldLayout';
import { labelFieldHints, unwrapLabelFieldValues, useTrackerLabelFields, wrapLabelFieldValue } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/trackerLabelFields';
import { trackerItemByIdAtom, trackerDataLoadedAtom, trackerItemsMapAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerDataAtoms';
import { getElectronCollabDocsSession, getPersonalCollabDocsSession, resolveDesktopCollabScope } from '../../store/atoms/collabDocuments';
import { pageTreeAncestors } from '@nimbalyst/collab-client/trackers-ui/embed';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { useMarkTrackerViewed } from '../../hooks/useTrackerUnread';
import { useRecordTrackerOpened } from '../../hooks/useRecordTrackerOpened';
import { isNativeItem } from './trackerContentMode';
import { useTrackerItemBody, useTrackerTeam } from './useTrackerItemBody';
import { useTrackerItemFields } from './useTrackerItemFields';
import { sanitizeTitleInput, useAutoSizedTitle } from './trackerTitleAutoSize';
import { TrackerLinksSection } from './TrackerLinksSection';
import { TrackerSavedDescription } from './TrackerSavedDescription';
import { TrackerPageAddField } from './TrackerPageAddField';
import { createCollectionItem } from './createCollectionItem';
import './TrackerPageView.css';

type CrumbParentKind = 'page' | 'item';
interface CrumbPlacement { typeId: string; parentFolderId?: string | null; parentKind?: CrumbParentKind }
interface CrumbItemPlacement { itemId: string; parentId?: string | null; parentKind?: CrumbParentKind }
interface CrumbFolder { folderId: string; parentFolderId?: string | null; parentKind?: CrumbParentKind; name: string }
interface CrumbDocument { documentId: string; parentFolderId?: string | null; parentKind?: CrumbParentKind; title: string; documentType?: string }
type CrumbItemLookup = (itemId: string) => { title: string; typeId: string } | null;
const NO_ITEMS: CrumbItemLookup = () => null;
const crumbTypeName = (typeId: string): string | null => {
  const model = globalRegistry.get(typeId);
  return model ? model.displayNamePlural || model.displayName || typeId : null;
};

export interface TrackerPageCrumb {
  /** Ancestor page names, root first. */
  ancestors: string[];
  /** Unplaced items sit under their type, which the crumb then names. */
  underType: boolean;
}

/**
 * Where a typed page sits in the Pages tree. A placed item reads its own
 * parents (pages and typed pages); an unplaced one sits under its type page,
 * so it reads the type's placement and then the type.
 */
export function trackerPageCrumb(
  itemId: string,
  typeId: string,
  tree: {
    itemPlacements: readonly CrumbItemPlacement[];
    typePlacements: readonly CrumbPlacement[];
    documents: readonly CrumbDocument[];
    folders: readonly CrumbFolder[];
    item?: CrumbItemLookup;
  },
): TrackerPageCrumb {
  const walk = { ...tree, item: tree.item ?? NO_ITEMS, typeName: crumbTypeName };
  const itemPlacement = tree.itemPlacements.find((candidate) => candidate.itemId === itemId);
  if (itemPlacement) {
    const parent = itemPlacement.parentId ? { id: itemPlacement.parentId, kind: itemPlacement.parentKind ?? 'page' } : null;
    return { ancestors: pageTreeAncestors(parent, walk), underType: false };
  }
  const typePlacement = tree.typePlacements.find((candidate) => candidate.typeId === typeId);
  const parent = typePlacement?.parentFolderId ? { id: typePlacement.parentFolderId, kind: typePlacement.parentKind ?? 'page' } : null;
  return { ancestors: pageTreeAncestors(parent, walk), underType: true };
}

/**
 * The ancestors of a type's placement, root first (the type page's crumb).
 * `folders` may be the session's folder list, which in a page tree is the
 * pages projected as folders.
 */
export function trackerPageCrumbFolders(
  typeId: string,
  placements: readonly CrumbPlacement[],
  folders: readonly CrumbFolder[],
  tree: { itemPlacements?: readonly CrumbItemPlacement[]; item?: CrumbItemLookup } = {},
): string[] {
  const placement = placements.find((candidate) => candidate.typeId === typeId);
  const parent = placement?.parentFolderId ? { id: placement.parentFolderId, kind: placement.parentKind ?? 'page' } : null;
  return pageTreeAncestors(parent, {
    documents: [],
    folders,
    itemPlacements: tree.itemPlacements ?? [],
    typePlacements: placements,
    item: tree.item ?? NO_ITEMS,
    typeName: crumbTypeName,
  });
}

/** A typed page's title and type, for a crumb walking up through typed pages. */
export function crumbItemLookup(records: ReadonlyMap<string, TrackerRecord>): CrumbItemLookup {
  return (itemId) => {
    const record = records.get(itemId);
    return record ? { title: getRecordTitle(record).trim(), typeId: record.primaryType } : null;
  };
}

/**
 * Whether a page should offer its legacy `description` back: only when it
 * holds text the body does not already contain (whitespace aside). Items
 * created with the same text in both fields have nothing to recover. Until
 * the body has loaded there is nothing to compare against, so nothing shows.
 */
export function legacyDescriptionToRecover(description: unknown, body: string | null): string | null {
  if (typeof description !== 'string' || body === null) return null;
  const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
  const saved = squash(description);
  return saved && !squash(body).includes(saved) ? description : null;
}

const NO_PLACEMENTS: Atom<readonly CrumbPlacement[]> = atom([]);
const NO_ITEM_PLACEMENTS: Atom<readonly CrumbItemPlacement[]> = atom([]);
const NO_FOLDERS: Atom<readonly CrumbFolder[]> = atom([]);
const NO_DOCUMENTS: Atom<readonly CrumbDocument[]> = atom([]);

/**
 * The team scope the crumb reads. The tab mounts once with whatever scope
 * Pages had at that moment, which can be none yet; resolve it here so the
 * crumb still reaches the team tree's live placements.
 */
function useTeamCrumbScope(workspacePath: string, collabScope: CollabScope | undefined, enabled: boolean): CollabScope | null {
  const [resolved, setResolved] = useState<CollabScope | null>(null);
  useEffect(() => {
    if (!enabled || collabScope) return;
    let cancelled = false;
    void resolveDesktopCollabScope(workspacePath).then(({ scope }) => {
      if (!cancelled) setResolved(scope);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, collabScope, workspacePath]);
  return collabScope ?? resolved;
}

/**
 * The page's crumb: Personal types read the workspace's Personal session,
 * team types the team session. The session's atoms carry every placement and
 * page change, so the crumb follows a move while the tab is open.
 */
function useTrackerPageCrumb(
  itemId: string,
  typeId: string,
  sharing: string,
  workspacePath: string,
  collabScope: CollabScope | undefined,
): TrackerPageCrumb & { section: string | null } {
  const personal = sharing === 'personal';
  const teamScope = useTeamCrumbScope(workspacePath, collabScope, !personal);
  const session = useMemo(
    () => (personal ? getPersonalCollabDocsSession(workspacePath) : teamScope ? getElectronCollabDocsSession(teamScope) : null),
    [personal, workspacePath, teamScope],
  );
  // One derived atom: the crumb re-renders the page only when its names change,
  // not on every tracker item edit it reads titles from.
  const crumbAtom = useMemo(() => selectAtom(
    atom((get) => trackerPageCrumb(itemId, typeId, {
      itemPlacements: get<readonly CrumbItemPlacement[]>(session?.atoms.itemPlacements ?? NO_ITEM_PLACEMENTS),
      typePlacements: get<readonly CrumbPlacement[]>(session?.atoms.typePlacements ?? NO_PLACEMENTS),
      documents: get<readonly CrumbDocument[]>(session?.atoms.sharedDocuments ?? NO_DOCUMENTS),
      folders: get<readonly CrumbFolder[]>(session?.atoms.sharedFolders ?? NO_FOLDERS),
      item: crumbItemLookup(get(trackerItemsMapAtom)),
    })),
    (value) => value,
    (left, right) => left.underType === right.underType
      && left.ancestors.length === right.ancestors.length
      && left.ancestors.every((name, index) => name === right.ancestors[index]),
  ), [itemId, typeId, session]);
  const crumb = useAtomValue(crumbAtom);
  return { ...crumb, section: personal ? 'Personal' : null };
}

export interface TrackerPageViewProps {
  itemId: string;
  workspacePath: string;
  /** Pages mode's team scope; the crumb reads team type placements from it. */
  collabScope?: CollabScope;
  /** Open another page (a link or a relationship chip). */
  onOpenItem?: (itemId: string) => void;
}

export const TrackerPageView: React.FC<TrackerPageViewProps> = ({
  itemId,
  workspacePath,
  collabScope,
  onOpenItem,
}) => {
  const item = useAtomValue(trackerItemByIdAtom(itemId));
  const trackerDataLoaded = useAtomValue(trackerDataLoadedAtom);
  const model = useMemo(() => globalRegistry.get(item?.primaryType ?? ''), [item?.primaryType]);
  const referenceSource = useMemo(
    () => (item ? { itemId: item.id, type: item.primaryType } : null),
    [item?.id, item?.primaryType],
  );
  const [linksRevision, setLinksRevision] = useState(0);
  const bumpLinks = useCallback(() => setLinksRevision((r) => r + 1), []);
  // The body as last saved from this tab. The hook's `contentMarkdown` only
  // moves on load and on remote updates, so own edits are tracked here.
  const [savedBody, setSavedBody] = useState<string | null>(null);
  const handleContentSaved = useCallback((markdown: string) => {
    setSavedBody(markdown);
    bumpLinks();
  }, [bumpLinks]);

  useMarkTrackerViewed(item, workspacePath);
  useRecordTrackerOpened(item?.id, workspacePath);

  const { teamOrgId, teamMembers } = useTrackerTeam(workspacePath);
  const writeAccess = useMemo(() => resolveTrackerWriteAccess(model), [model]);
  // Pages hold native items; any other source keeps its fields read-only here.
  const editable = item ? isNativeItem(item) && writeAccess.canWrite : false;

  const body = useTrackerItemBody({
    itemId,
    item,
    workspacePath,
    teamOrgId,
    // A page is a full document surface: same block handles and selection
    // toolbar as every other editor tab.
    forceFloatingToolbar: true,
    onContentSaved: handleContentSaved,
  });
  // A load, a remote update, or switching pages supersedes the last own save.
  useEffect(() => setSavedBody(null), [body.contentMarkdown, itemId]);
  const { localTitle, storedValues, handleTextFieldChange, handleFieldChange } = useTrackerItemFields({
    itemId,
    item,
    editable,
    sharing: body.sharing,
    onRelationshipsReindexed: bumpLinks,
  });
  const titleRef = useAutoSizedTitle(localTitle);

  const crumb = useTrackerPageCrumb(itemId, item?.primaryType ?? '', body.sharing, workspacePath, collabScope);

  // One row of single-valued fields: tags, lists and label rows never reach the
  // page header, and neither does any relationship -- links belong to Links.
  const tagsField = useMemo(() => getTrackerTagsField(item?.primaryType ?? ''), [item?.primaryType]);
  const labelLayout = useTrackerLabelFields(item?.primaryType ?? '', item?.fields);
  const { chipFields: singleValuedFields } = useTrackerChipFieldSections(
    item?.primaryType ?? '', tagsField ? [tagsField.name] : [], labelLayout.fields, true,
  );
  const chipFields = useMemo(
    () => singleValuedFields.filter((field) => field.type !== 'relationship' && field.type !== 'reference'),
    [singleValuedFields],
  );
  const chipValues = useMemo(() => unwrapLabelFieldValues(labelLayout.fields, storedValues), [labelLayout.fields, storedValues]);
  const storedValuesRef = useRef(storedValues);
  storedValuesRef.current = storedValues;
  const handleChipSave = useCallback((fieldName: string, value: unknown) => {
    const field = chipFields.find((candidate) => candidate.name === fieldName);
    if (!field) return;
    handleFieldChange(field, wrapLabelFieldValue(field, value, storedValuesRef.current[fieldName]));
  }, [chipFields, handleFieldChange]);
  const handleCreateCollection = useCallback(
    (title: string, type: string) => createCollectionItem({ workspacePath, title, type }),
    [workspacePath],
  );

  // The row shows only fields that hold a value, plus any the user added from
  // the "+" menu while this page is open (so a just-added field stays put while
  // it is being filled in).
  const [addedFields, setAddedFields] = useState<ReadonlySet<string>>(() => new Set());
  const [fieldToOpen, setFieldToOpen] = useState<string | null>(null);
  useEffect(() => {
    setAddedFields(new Set());
    setFieldToOpen(null);
  }, [itemId]);
  const shownFields = useMemo(
    () => chipFields.filter((field) => addedFields.has(field.name) || !isTrackerFieldEmpty(chipValues[field.name])),
    [chipFields, chipValues, addedFields],
  );
  const emptyFields = useMemo(
    () => chipFields.filter((field) => !shownFields.includes(field)),
    [chipFields, shownFields],
  );
  const handleAddField = useCallback((fieldName: string) => {
    setAddedFields((prev) => new Set(prev).add(fieldName));
    setFieldToOpen(fieldName);
  }, []);
  // A field added from the menu opens in its ordinary chip editor. The chip
  // owns its popover state, so open it the way a user would. Booleans toggle
  // on click, so they are added without being set.
  const propsRowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!fieldToOpen) return;
    setFieldToOpen(null);
    if (chipFields.find((field) => field.name === fieldToOpen)?.type === 'boolean') return;
    const pill = Array.from(propsRowRef.current?.querySelectorAll<HTMLButtonElement>('.tracker-field-pill') ?? [])
      .find((candidate) => candidate.dataset.field === fieldToOpen);
    pill?.click();
  }, [fieldToOpen, chipFields]);

  if (!item) {
    return (
      <div className="tracker-page-view flex h-full items-center justify-center bg-nim text-sm text-nim-faint" data-testid="tracker-page-view">
        {trackerDataLoaded ? 'This page is no longer available' : 'Loading…'}
      </div>
    );
  }

  const title = getRecordTitle(item);
  const typeName = model?.displayName || item.primaryType;
  const typeColor = model?.color || TYPE_COLORS[item.primaryType] || NEUTRAL_SWATCH;
  const { contentMode, localEditorConfig, collabEditorConfig } = body;
  const currentBody = body.contentMarkdown === null ? null : savedBody ?? body.contentMarkdown;
  const savedDescription = body.hasRichContent ? legacyDescriptionToRecover(item.fields.description, currentBody) : null;

  return (
    <div className="tracker-page-view flex h-full min-h-0 flex-col overflow-hidden bg-nim" data-testid="tracker-page-view" data-item-id={item.id}>
      <div className="tracker-page-view-scroller min-h-0 flex-1 overflow-y-auto">
        <div className="tracker-page-view-header">
          <div className="tracker-page-view-crumb mb-2.5 truncate text-xs text-nim-faint select-text" data-testid="tracker-page-crumb">
            {[...(crumb.section ? [crumb.section] : []), ...crumb.ancestors].map((part, index) => (
              <span key={`${index}:${part}`}>{part} / </span>
            ))}
            {crumb.underType && <><span className="text-nim-muted">{typeName}</span>{' / '}</>}
            {title}
          </div>
          {editable ? (
            <textarea
              ref={titleRef}
              rows={1}
              value={localTitle}
              onChange={(e) => handleTextFieldChange('title', sanitizeTitleInput(e.target.value))}
              onKeyDown={(e) => {
                e.stopPropagation();
                // Titles stay single-line: Enter commits instead of adding a row.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              className="tracker-page-view-title m-0 mb-3 w-full resize-none overflow-hidden break-words border-none bg-transparent p-0 text-[28px] font-medium leading-tight text-nim outline-none placeholder:text-nim-faint"
              placeholder="Untitled"
              data-testid="tracker-page-title"
            />
          ) : (
            <h1 className="tracker-page-view-title m-0 mb-3 break-words text-[28px] font-medium leading-tight text-nim select-text">{title}</h1>
          )}
          <div ref={propsRowRef} className="tracker-page-view-props flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-nim pb-3" data-testid="tracker-page-props">
            <span
              className="tracker-page-view-type inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium"
              style={{ color: typeColor, backgroundColor: `${typeColor}24` }}
            >
              <MaterialSymbol icon={model?.icon || 'label'} size={13} />
              {typeName}
            </span>
            {shownFields.length > 0 && (
              <TrackerFieldPills
                fields={shownFields}
                values={chipValues}
                labelFields
                editable={editable}
                teamMembers={teamMembers}
                onSave={handleChipSave}
                onOpenItem={onOpenItem}
                onCreateCollection={handleCreateCollection}
                fieldHints={labelFieldHints(labelLayout.fields, storedValues)}
                className="tracker-page-view-field-pills"
                testIdBase="tracker-page-field"
              />
            )}
            {editable && <TrackerPageAddField fields={emptyFields} onAdd={handleAddField} />}
          </div>
        </div>

        {savedDescription !== null && (
          <div className="tracker-page-view-gutter">
            <TrackerSavedDescription
              key={item.id} description={savedDescription} currentBody={currentBody} editor={body.recoveryEditor}
              canInsert={editable && body.contentLoaded && (contentMode === 'local-pglite' || (contentMode === 'collaborative' && body.hasSyncedOnce && body.collabStatus === 'connected'))}
            />
          </div>
        )}

        <div className="tracker-page-view-body relative" data-testid="tracker-page-body">
          {contentMode === 'local-pglite' && localEditorConfig ? (
            <TrackerReferenceSourceProvider value={referenceSource}>
              <NimbalystEditor key={`${item.id}-${body.externalContentEpoch}`} config={localEditorConfig} />
            </TrackerReferenceSourceProvider>
          ) : contentMode === 'collaborative' && collabEditorConfig ? (
            <>
              {!body.hasSyncedOnce && (
                <div className="absolute inset-0 z-10 flex items-start justify-center bg-nim pt-6 pointer-events-none" data-testid="tracker-content-loading">
                  <span className="text-sm text-nim-muted">Loading content...</span>
                </div>
              )}
              <TrackerReferenceSourceProvider value={referenceSource}>
                <NimbalystEditor key={`collab-${item.id}-${body.providerEpoch}`} config={collabEditorConfig} />
              </TrackerReferenceSourceProvider>
            </>
          ) : (contentMode === 'local-pglite' || contentMode === 'collaborative') && !body.contentLoaded ? (
            <div className="tracker-page-view-gutter py-4 text-sm text-nim-faint">Loading...</div>
          ) : contentMode === 'collaborative' && body.collabLoading ? (
            <div className="tracker-page-view-gutter py-4 text-sm text-nim-faint">Connecting...</div>
          ) : item.system.documentPath ? (
            // File-backed pages keep their body in the file; Pages mode does not edit it.
            <div className="tracker-page-view-gutter py-4 text-sm text-nim-muted">
              This page&apos;s body lives in <span className="font-mono">{item.system.documentPath}</span>.
            </div>
          ) : null}
        </div>

        <div className="tracker-page-view-links">
          <TrackerLinksSection
            workspacePath={workspacePath}
            itemId={item.id}
            itemType={item.primaryType}
            revision={linksRevision}
            onOpenItem={onOpenItem}
          />
        </div>
      </div>
    </div>
  );
};
