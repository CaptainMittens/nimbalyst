/**
 * A tracker view drawn live from the items, in its own mode with its own
 * filters -- e.g. a type page's built-in "All" table. The host mounts it inside
 * a `TrackersUIProvider` and passes how to open the view and an item.
 *
 * Loaded lazily (`LazyTrackerViewEmbed`): it pulls in the list, grid and board
 * surfaces, and a surface that shows no view must not pay for them.
 */

import { useCallback, useMemo, type JSX, type ReactNode } from 'react';
import type { CollabOpenOptions } from '@nimbalyst/collab-client/core';
import { computeReadiness } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/trackerReadiness';
import { globalRegistry } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { getRecordStatus, getRecordTitle } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { selectArchivedForView, type SavedView, type SavedViewDefinition, type TrackerIdentity } from '@nimbalyst/collab-client/trackers';
import { useTrackersUI } from '../TrackersUIProvider';
import { useTrackerDataSelector } from '../useTrackerData';
import { useTrackerViewRows } from '../useTrackerViewRows';
import { resolveViewMode } from '../resolveViewMode';
import { TrackerListView } from '../TrackerListView';
import { TrackerBoardSurface } from '../board/TrackerBoardSurface';
import { TrackerGridSurface, type TrackerGridDerivedColumn, type TrackerGridUpdateEntry } from '../grid/TrackerGridSurface';
import { isViewRecordEditable, writeViewEdits } from './viewItemEdits';

const DEFAULT_BODY_HEIGHT_PX = 420;
const MODE_LABEL: Record<string, string> = {
  list: 'list', table: 'table', kanban: 'board',
  timeline: 'list', radar: 'list', 'tag-board': 'list', inbox: 'list',
};

function describeQuery(definition: SavedViewDefinition, mode: string): string {
  const model = definition.selectedType === 'all' ? null : globalRegistry.get(definition.selectedType);
  const subject = definition.selectedType === 'all'
    ? 'All items'
    : model?.displayNamePlural || definition.selectedType;
  const filters = definition.activeFilters.length
    + definition.tagFilter.length
    + (definition.columnFilters?.clauses.length ?? 0);
  return `${subject} · ${MODE_LABEL[mode] ?? mode}${filters > 0 ? ` · ${filters} filter${filters === 1 ? '' : 's'}` : ''}`;
}

export interface TrackerViewEmbedProps {
  /** A view the host already holds, saved or synthetic (e.g. a type page's built-in "All"). */
  view: SavedView;
  onOpenAsTable?: (view: SavedView) => void;
  onOpenItem?: (itemId: string, options?: CollabOpenOptions) => void;
  /**
   * `card` is the bordered block a document embeds at a fixed height; `page`
   * drops the card chrome and fills its container, for a tab that is the view.
   */
  variant?: 'card' | 'page';
  /** Body height in pixels for the `card` variant. */
  height?: number;
  /** Read-only columns after the fields, in table mode (a type page's Where). */
  derivedColumns?: readonly TrackerGridDerivedColumn[];
  /**
   * Items of any of these types, instead of the view's one type: a type page
   * lists its subtypes' items too. The view's type still picks the columns.
   */
  typeIds?: readonly string[];
  /** Table cells edit their items unless this is set (or the host has no data source). */
  readOnly?: boolean;
}

/** Draws a view the caller supplies, without looking it up among the saved views. */
export function TrackerViewEmbed({
  view,
  onOpenAsTable,
  onOpenItem,
  variant = 'card',
  height,
  derivedColumns,
  typeIds,
  readOnly,
}: TrackerViewEmbedProps): JSX.Element {
  const { identity, capabilities, dataSource } = useTrackersUI();
  const records = useTrackerDataSelector((state) => state.records);
  const loaded = useTrackerDataSelector((state) => state.loaded);
  const writeEdits = useCallback(
    (entries: readonly TrackerGridUpdateEntry[]) => (dataSource ? writeViewEdits(dataSource, entries) : Promise.resolve()),
    [dataSource],
  );
  return (
    <LoadedViewEmbed
      view={view}
      records={records}
      loaded={loaded}
      identity={identity}
      renderableViewModes={capabilities.renderableViewModes}
      onOpenAsTable={onOpenAsTable}
      onOpenItem={onOpenItem}
      height={height ?? DEFAULT_BODY_HEIGHT_PX}
      variant={variant}
      derivedColumns={derivedColumns}
      typeIds={typeIds}
      onItemsUpdate={readOnly || !dataSource ? undefined : writeEdits}
    />
  );
}

function LoadedViewEmbed({
  view,
  records,
  loaded,
  identity,
  renderableViewModes,
  onOpenAsTable,
  onOpenItem,
  height,
  variant,
  derivedColumns,
  typeIds,
  onItemsUpdate,
}: {
  view: SavedView;
  records: TrackerRecord[];
  loaded: boolean;
  identity: TrackerIdentity | null;
  renderableViewModes: ReadonlySet<SavedViewDefinition['viewMode']>;
  onOpenAsTable?: (view: SavedView) => void;
  onOpenItem?: (itemId: string, options?: CollabOpenOptions) => void;
  height: number;
  variant: 'card' | 'page';
  derivedColumns?: readonly TrackerGridDerivedColumn[];
  typeIds?: readonly string[];
  onItemsUpdate?: (entries: readonly TrackerGridUpdateEntry[]) => Promise<void>;
}): JSX.Element {
  const { definition } = view;
  // Readiness is a property of the whole dependency graph, so it reads every record.
  const readinessByItemId = useMemo(() => computeReadiness(records, getRecordStatus), [records]);
  const typeKey = typeIds?.join('\u001f');
  const scoped = useMemo(() => {
    // An archived item is out of every view that does not ask for it, as in
    // Tracker mode; a type page then drops a typed page once it is archived.
    const active = selectArchivedForView(records, definition);
    if (!typeIds) return { records: active, definition };
    const wanted = new Set(typeIds);
    return {
      records: active.filter((record) => record.typeTags.some((tag) => wanted.has(tag))),
      definition: { ...definition, selectedType: 'all' },
    };
    // typeKey stands for typeIds, which callers rebuild on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, definition, typeKey]);
  const { rows } = useTrackerViewRows(scoped.records, scoped.definition, { identity, readinessByItemId });
  const { mode } = resolveViewMode(definition.viewMode, { renderableViewModes });
  const titles = useMemo(() => new Map(records.map((record) => [record.id, getRecordTitle(record).trim()])), [records]);
  const resolveRelationshipLabel = useCallback((itemId: string) => titles.get(itemId) || undefined, [titles]);
  const openItem = useCallback((itemId: string, options?: CollabOpenOptions) => onOpenItem?.(itemId, options), [onOpenItem]);
  const byId = useMemo(() => new Map(records.map((record) => [record.id, record])), [records]);
  const isRowEditable = useCallback((itemId: string) => {
    const record = byId.get(itemId);
    return record ? isViewRecordEditable(record) : false;
  }, [byId]);

  let body: ReactNode;
  switch (mode) {
    case 'table':
      body = (
        <TrackerGridSurface
          rows={rows}
          trackerType={definition.selectedType}
          columnConfig={definition.columnConfig}
          sortBy={definition.sortBy}
          sortDirection={definition.sortDirection}
          columnFilters={definition.columnFilters}
          resolveRelationshipLabel={resolveRelationshipLabel}
          onOpenItem={onOpenItem}
          loaded={loaded}
          derivedColumns={derivedColumns}
          isRowEditable={onItemsUpdate ? isRowEditable : undefined}
          onItemsUpdate={onItemsUpdate}
        />
      );
      break;
    case 'kanban':
      body = (
        <TrackerBoardSurface
          rows={rows}
          trackerType={definition.selectedType}
          groupBy={definition.groupBy}
          ordering={definition.ordering}
          statusScope={definition.statusScope}
          resolveRelationshipLabel={resolveRelationshipLabel}
          onOpenItem={openItem}
          currentIdentity={identity}
        />
      );
      break;
    default:
      body = (
        <TrackerListView
          rows={rows}
          groupBy={definition.groupBy}
          showType={definition.selectedType === 'all'}
          onOpenItem={openItem}
          loaded={loaded}
        />
      );
  }

  const isPage = variant === 'page';
  return (
    <div
      className={isPage
        ? 'tracker-saved-view-embed tracker-saved-view-embed--page flex min-h-0 flex-1 flex-col overflow-hidden'
        : 'tracker-saved-view-embed my-3 flex flex-col overflow-hidden rounded-lg border border-nim bg-nim-secondary'}
      data-testid="tracker-saved-view-embed"
      data-view-id={view.id}
      data-view-mode={mode}
      contentEditable={false}
    >
      {isPage ? null : (
        <div className="tracker-saved-view-embed-head flex items-center gap-2.5 border-b border-nim px-3 py-2 text-xs">
          <span className="font-medium text-nim">{view.name}</span>
          <span className="rounded bg-nim-tertiary px-2 py-0.5 font-mono text-[11px] text-nim-muted">
            {describeQuery(definition, mode)}
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-nim-success">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--nim-success)]" aria-hidden />
            live
          </span>
        </div>
      )}
      <div
        className={isPage
          ? 'tracker-saved-view-embed-body flex min-h-0 flex-1 flex-col bg-nim'
          : 'tracker-saved-view-embed-body flex min-h-0 flex-col bg-nim'}
        style={isPage ? undefined : { height }}
      >
        {body}
      </div>
      <div className="tracker-saved-view-embed-foot flex items-center gap-3.5 px-3 py-1.5 text-[11px] text-nim-faint">
        <span>{rows.length} {rows.length === 1 ? 'item' : 'items'}</span>
        {onOpenAsTable ? (
          <button
            type="button"
            className="ml-auto cursor-pointer border-none bg-transparent p-0 text-[11px] text-nim-link hover:underline"
            data-testid="tracker-saved-view-embed-open"
            onClick={() => onOpenAsTable(view)}
          >
            Open as table
          </button>
        ) : null}
      </div>
    </div>
  );
}
