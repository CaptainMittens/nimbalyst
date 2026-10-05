/**
 * A typed page laid out as a document page, not the tracker detail pane. Top
 * to bottom: the crumb (where the page sits in the Pages tree), the title, one
 * row of the type chip and the single-valued fields, the body, and the Links
 * section.
 *
 * Shared by the desktop and the web console. The host owns the data: it
 * passes the item, the crumb and the field values, saves edits through
 * `onRename` and `onUpdateField`, renders the body (`renderBody`), and says
 * where the links come from (`linksSource`).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FieldDefinition } from '@nimbalyst/tracker-schema';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { globalRegistry } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { getRecordTitle } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';
import { TrackerFieldPills } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/TrackerFieldPills';
import { getTrackerTagsField, useTrackerChipFieldSections } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/trackerChipFields';
import { isTrackerFieldEmpty } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/trackerFieldLayout';
import { unwrapLabelFieldValues, useTrackerLabelFields, wrapLabelFieldValue } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/trackerLabelFields';
import { NEUTRAL_SWATCH, TYPE_COLORS } from '../board/trackerBoardTokens';
import type { PageLinksSource } from './pageLinks';
import type { TrackerPageCrumb } from './trackerPageCrumb';
import { TrackerLinksSection } from './TrackerLinksSection';
import { TrackerPageAddField } from './TrackerPageAddField';
import { PageHistoryButton } from './PageHistoryButton';
import { confirmDestructive } from '../../ui-primitives/confirmDestructive';
import { sanitizeTitleInput, useAutoSizedTitle } from './trackerTitleAutoSize';
import './TrackerPageView.css';

type FieldPillsProps = React.ComponentProps<typeof TrackerFieldPills>;

export interface TrackerPageViewProps {
  /** Null while the item is loading or after it is gone. */
  item: TrackerRecord | null;
  /** Whether the host has loaded its items: a missing item then reads as gone. */
  loaded: boolean;
  /** Where the page sits; `section` ("Personal") leads the crumb when set. */
  crumb: TrackerPageCrumb & { section?: string | null };
  editable: boolean;
  /** The title as it is being edited; the host saves it. */
  title: string;
  onRename: (title: string) => void;
  /** The item's stored field values, label fields still wrapped. */
  fieldValues: Record<string, unknown>;
  onUpdateField: (field: FieldDefinition, value: unknown) => void;
  teamMembers?: FieldPillsProps['teamMembers'];
  onCreateCollection?: FieldPillsProps['onCreateCollection'];
  /** The body editor, or what stands in for it while it loads. */
  renderBody: () => React.ReactNode;
  /** Above the body, in the text gutter (a recovered description, a notice). */
  beforeBody?: React.ReactNode;
  linksSource?: PageLinksSource | null;
  /** Bumped by the host after a save that may have re-indexed links. */
  linksRevision?: number;
  /** Open another typed page (a Links entry or a relationship chip). */
  onOpenItem?: (itemId: string) => void;
  /** Open the body's page history; absent while the body has none to show. */
  onShowHistory?: () => void;
  /**
   * Archive the typed page through the tracker's archive (after an in-app
   * confirm). Absent where the host cannot write trackers.
   */
  onArchive?: () => void;
}

export const TrackerPageView: React.FC<TrackerPageViewProps> = ({
  item,
  loaded,
  crumb,
  editable,
  title: localTitle,
  onRename,
  fieldValues: storedValues,
  onUpdateField,
  teamMembers,
  onCreateCollection,
  renderBody,
  beforeBody,
  linksSource,
  linksRevision = 0,
  onOpenItem,
  onShowHistory,
  onArchive,
}) => {
  const itemId = item?.id ?? '';
  const model = useMemo(() => globalRegistry.get(item?.primaryType ?? ''), [item?.primaryType]);
  const titleRef = useAutoSizedTitle(localTitle);

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
    onUpdateField(field, wrapLabelFieldValue(field, value, storedValuesRef.current[fieldName]));
  }, [chipFields, onUpdateField]);

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
        {loaded ? 'This page is no longer available' : 'Loading…'}
      </div>
    );
  }

  const title = getRecordTitle(item);
  const typeName = model?.displayName || item.primaryType;
  const typeColor = model?.color || TYPE_COLORS[item.primaryType] || NEUTRAL_SWATCH;

  return (
    <div className="tracker-page-view flex h-full min-h-0 flex-col overflow-hidden bg-nim" data-testid="tracker-page-view" data-item-id={item.id}>
      <div className="tracker-page-view-scroller min-h-0 flex-1 overflow-y-auto">
        <div className="tracker-page-view-header">
          <div className="tracker-page-view-crumb-row mb-2.5 flex items-center gap-2">
            <div className="tracker-page-view-crumb min-w-0 flex-1 truncate text-xs text-nim-faint select-text" data-testid="tracker-page-crumb">
              {[...(crumb.section ? [crumb.section] : []), ...crumb.ancestors].map((part, index) => (
                <span key={`${index}:${part}`}>{part} / </span>
              ))}
              {crumb.underType && <><span className="text-nim-muted">{typeName}</span>{' / '}</>}
              {title}
            </div>
            {item.archived
              ? <span className="tracker-page-view-archived shrink-0 text-xs text-nim-faint">Archived</span>
              : onArchive && (
                <button
                  type="button"
                  className="tracker-page-view-archive flex shrink-0 items-center rounded border-none bg-transparent px-1.5 py-0.5 text-nim-faint cursor-pointer hover:bg-nim-hover hover:text-nim"
                  title="Archive page"
                  aria-label="Archive page"
                  onClick={() => {
                    void confirmDestructive(
                      'Archive page',
                      `Archive "${title}"? It leaves Pages and its type's table, with its comments and sessions kept. Restore it from its tracker's Archived view.`,
                      'Archive',
                    ).then((accepted) => { if (accepted) onArchive(); });
                  }}
                >
                  <MaterialSymbol icon="archive" size={15} />
                </button>
              )}
            {onShowHistory && <PageHistoryButton onClick={onShowHistory} />}
          </div>
          {editable ? (
            <textarea
              ref={titleRef}
              rows={1}
              value={localTitle}
              onChange={(e) => onRename(sanitizeTitleInput(e.target.value))}
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
                onCreateCollection={onCreateCollection}
                className="tracker-page-view-field-pills"
                testIdBase="tracker-page-field"
              />
            )}
            {editable && <TrackerPageAddField fields={emptyFields} onAdd={handleAddField} />}
          </div>
        </div>

        {beforeBody}

        <div className="tracker-page-view-body relative" data-testid="tracker-page-body">
          {renderBody()}
        </div>

        <div className="tracker-page-view-links">
          <TrackerLinksSection
            linksSource={linksSource}
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
