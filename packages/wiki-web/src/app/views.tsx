/**
 * The main pane's views: a plain page, a typed page, a type's table, search.
 * Each reads the tree from the docs session and items from the tracker
 * provider, the same stores the sidebar reads.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCollabDocsUI, useCollabPagesState, useSharedFolders } from '@nimbalyst/collab-bundle/docs-ui';
import {
  TrackerSurfaceMessage,
  useTrackerCommand,
  useTrackerDataSelector,
  type loadTrackerPage,
} from '@nimbalyst/collab-bundle/trackers-ui';
import type { LocalSearchHit } from '@nimbalyst/local-wiki';
import { wikiApi } from '../api/client';
import type { WikiRoute } from '../host/LocalCollabHost';
import type { LocalTrackerDataSource } from '../host/LocalTrackerDataSource';
import { PageEditor } from './PageEditor';

export type PageModule = Awaited<ReturnType<typeof loadTrackerPage>>;
type Navigate = (route: WikiRoute) => void;

function usePageTitle(title: string | null): void {
  useEffect(() => {
    if (title === null) return;
    document.title = `${title || 'Untitled'} · Local wiki`;
  }, [title]);
}

/** A title field that commits on Enter or blur. */
function TitleInput({ value, onCommit }: { value: string; onCommit: (title: string) => Promise<void> }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) void onCommit(next).catch(() => setDraft(value));
    else setDraft(value);
  };
  return (
    <input
      className="wiki-web-title w-full border-0 bg-transparent p-0 text-2xl font-semibold text-nim outline-none"
      value={draft}
      aria-label="Page title"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        if (event.key === 'Escape') setDraft(value);
      }}
    />
  );
}

export function PageView({ pageId, filePath }: { pageId: string; filePath: string | null }) {
  const { session } = useCollabDocsUI();
  const { documents } = useCollabPagesState();
  const folders = useSharedFolders();
  const document = documents.find((candidate) => candidate.documentId === pageId) ?? null;
  usePageTitle(document?.title ?? null);
  const crumbs = useMemo(() => {
    const byId = new Map(folders.map((folder) => [folder.folderId, folder]));
    const out: string[] = [];
    for (let parent = document?.parentFolderId ? byId.get(document.parentFolderId) : undefined; parent; parent = parent.parentFolderId ? byId.get(parent.parentFolderId) : undefined) {
      out.unshift(parent.name);
      if (out.length > 32) break;
    }
    return out;
  }, [document?.parentFolderId, folders]);
  const rename = useCallback(async (title: string) => {
    await session.updateDocumentTitle(pageId, title);
  }, [pageId, session]);

  if (!document) {
    return <TrackerSurfaceMessage icon="search_off" message="This page is not in the wiki." hint="It may have been moved to the trash." testId="wiki-web-page-missing" />;
  }
  return (
    <article className="wiki-web-page flex min-h-full flex-col" data-testid="wiki-web-page" data-page-id={pageId}>
      <header className="wiki-web-page-header px-8 pt-6">
        {crumbs.length > 0 ? <div className="mb-1 truncate text-xs text-nim-faint">{crumbs.join(' / ')}</div> : null}
        <TitleInput value={document.title} onCommit={rename} />
      </header>
      {document.documentType === 'markdown' ? (
        <PageEditor key={pageId} pageId={pageId} />
      ) : (
        // Drawings, mind maps and other editor pages need their extension's editor, which the browser app does not ship.
        <TrackerSurfaceMessage icon="open_in_new" message="Open this page in Nimbalyst" hint={filePath ?? undefined} testId="wiki-web-editor-page" />
      )}
    </article>
  );
}

export function TypedPageView({ itemId, module, trackers, navigate }: { itemId: string; module: PageModule; trackers: LocalTrackerDataSource; navigate: Navigate }) {
  const recordsById = useTrackerDataSelector((state) => state.recordsById);
  const loaded = useTrackerDataSelector((state) => state.loaded);
  const command = useTrackerCommand();
  const { documents, typePlacements, itemPlacements } = useCollabPagesState();
  const folders = useSharedFolders();
  const [error, setError] = useState<string | null>(null);
  const item = recordsById.get(itemId) ?? null;
  const title = typeof item?.fields.title === 'string' ? item.fields.title : '';
  usePageTitle(item ? title : null);

  const crumb = useMemo(
    () => (item
      ? module.trackerPageCrumb(item.id, item.primaryType, { itemPlacements, typePlacements, documents, folders, item: module.crumbItemLookup(recordsById) })
      : { ancestors: [], underType: false }),
    [module, item, itemPlacements, typePlacements, documents, folders, recordsById],
  );
  const update = useCallback(async (updates: Record<string, unknown>) => {
    setError(null);
    const outcome = await command({ type: 'update-item', input: { itemId, updates } });
    const result = outcome.result as { success?: boolean; error?: string } | undefined;
    if (result?.success === false) throw new Error(result.error || 'The page could not be saved');
  }, [command, itemId]);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  if (!item && loaded) {
    return <TrackerSurfaceMessage icon="search_off" message="This item is not in the wiki." hint="It may have been moved to the trash." testId="wiki-web-item-missing" />;
  }
  const storage = item ? trackers.typeInfo(item.primaryType)?.storage ?? 'pages' : 'pages';
  const { TrackerPageView } = module;
  return (
    <div className="wiki-web-typed-page h-full min-h-0" data-testid="wiki-web-typed-page">
      {error ? <div className="px-4 py-2 text-xs text-nim-error" role="alert">{error}</div> : null}
      <TrackerPageView
        item={item}
        loaded={loaded}
        crumb={crumb}
        editable
        title={title}
        onRename={(next) => void update({ title: next }).catch(fail)}
        fieldValues={item?.fields ?? {}}
        onUpdateField={(field, value) => void update({ [field.name]: value }).catch(fail)}
        renderBody={() => (item
          ? storage === 'pages'
            ? <PageEditor key={item.id} pageId={item.id} trackerReferenceSource={{ itemId: item.id, type: item.primaryType }} />
            : <div className="px-8 py-3 text-xs text-nim-faint">A row of a table type has fields only; its type keeps all rows in one CSV file.</div>
          : null)}
        onOpenItem={(id) => navigate({ kind: 'item', id })}
        onArchive={() => void command({ type: 'archive-item', itemId, archive: true }).then(() => navigate({ kind: 'home' })).catch(fail)}
      />
    </div>
  );
}

export function TypeTableView({ typeId, module, trackers, navigate }: { typeId: string; module: PageModule; trackers: LocalTrackerDataSource; navigate: Navigate }) {
  const { itemPlacements } = useCollabPagesState();
  const folders = useSharedFolders();
  const recordsById = useTrackerDataSelector((state) => state.recordsById);
  const info = trackers.typeInfo(typeId);
  usePageTitle(info?.displayNamePlural ?? null);
  if (!info) return <TrackerSurfaceMessage icon="search_off" message="This type is not defined in .nimbalyst/trackers." testId="wiki-web-type-missing" />;
  const { TypePageTable } = module;
  return (
    <div className="wiki-web-type-page flex min-h-full flex-col" data-testid="wiki-web-type-page">
      <div className="px-8 pt-6">
        <h1 className="m-0 text-2xl font-semibold text-nim">{info.displayNamePlural}</h1>
        <div className="mt-1 text-xs text-nim-faint">{info.storage === 'table' ? 'Stored as one CSV file' : 'One markdown page per item'}</div>
      </div>
      <div className="px-8 pb-8 pt-4">
        <TypePageTable
          typeId={typeId}
          typeLabel={info.displayName}
          rootLabel="Local wiki"
          itemPlacements={itemPlacements}
          pages={folders}
          itemTitle={(id) => {
            const record = recordsById.get(id);
            return record ? String(record.fields.title ?? '') : null;
          }}
          onOpenItem={(id) => navigate({ kind: 'item', id })}
        />
      </div>
    </div>
  );
}

export function SearchView({ query, navigate }: { query: string; navigate: Navigate }) {
  const [hits, setHits] = useState<LocalSearchHit[] | null>(null);
  usePageTitle(`Search: ${query}`);
  useEffect(() => {
    let live = true;
    setHits(null);
    void wikiApi.search(query, 50).then((result) => {
      if (live) setHits(result);
    });
    return () => {
      live = false;
    };
  }, [query]);
  return (
    <div className="wiki-web-search px-8 py-6" data-testid="wiki-web-search">
      <h1 className="m-0 mb-4 text-xl font-semibold text-nim">Search: {query}</h1>
      {hits === null ? <div className="text-xs text-nim-faint">Searching…</div> : hits.length === 0 ? <div className="text-sm text-nim-muted">No pages match.</div> : null}
      <ul className="m-0 list-none p-0">
        {(hits ?? []).map((hit) => (
          <li key={hit.id} className="mb-3">
            <button type="button" className="text-left text-sm font-medium text-nim-link hover:underline" onClick={() => navigate(hit.type ? { kind: 'item', id: hit.id } : { kind: 'page', id: hit.id })}>
              {hit.title}
            </button>
            {hit.snippet ? <div className="mt-0.5 text-xs text-nim-muted">{hit.snippet}</div> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
