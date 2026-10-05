/**
 * The table half of a type's page: every item of the type and its subtypes,
 * wherever each item's page lives -- the Where column says which page that
 * is. The shared view embed fed a built-in "All" view; named views are
 * created on purpose, none are derived here.
 *
 * The host wraps it in its `TrackersUIProvider`, so the rows come from the
 * host's tracker data and edits go through the host's writes.
 */

import React, { useMemo } from 'react';
import type { CollabOpenOptions } from '@nimbalyst/collab-client/core';
import { globalRegistry } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { resolveRoleFieldName } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';
import type { TrackerGridDerivedColumn } from '../grid/TrackerGridSurface';
import { typeWithSubtypes } from '../../docs/collabPageTree';
import { LazyTrackerViewEmbed as TrackerViewEmbed } from '../embed/LazyTrackerViewEmbed';
import { LazyPlacedViewEmbed } from '../embed/LazyPlacedViewEmbed';
import type { PlacedViewHandoff } from './placedViewHandoff';
import { createTypePageView } from '../embed/typePageView';
import { createItemWhereResolver, type WherePage, type WherePlacement } from '../embed/typePageWhere';

export interface TypePageTableProps {
  typeId: string;
  temporaryView?: PlacedViewHandoff | null;
  onClearTemporaryView?: () => void;
  /** The type's name, shown in Where for an item with no placement. */
  typeLabel: string;
  /** Shown in Where for an item at the root of its section ("Team", "Personal"). */
  rootLabel: string;
  /** Typed pages' placements in the section. */
  itemPlacements: readonly WherePlacement[];
  /** Every page that can be a parent, as the docs session lists them. */
  pages: readonly WherePage[];
  /** A typed page's title, for one that is a parent; null when unknown. */
  itemTitle: (itemId: string) => string | null;
  onOpenItem: (itemId: string, options?: CollabOpenOptions) => void;
}

/** The type and every type that extends it: the tree row counts them all, so the table lists them all. */
export function typePageTypeIds(typeId: string): string[] {
  return typeWithSubtypes(typeId, {
    typeExtends: (id) => globalRegistry.get(id)?.extends ?? null,
    listedTypes: () => globalRegistry.getListed().map((listed) => ({ typeId: listed.type, name: listed.displayName })),
  });
}

export function TypePageTable({ typeId, typeLabel, rootLabel, itemPlacements, pages, itemTitle, onOpenItem, temporaryView, onClearTemporaryView }: TypePageTableProps): React.JSX.Element {
  const model = globalRegistry.get(typeId);
  const view = useMemo(() => createTypePageView(typeId), [typeId]);
  const typeIds = useMemo(() => typePageTypeIds(typeId), [typeId, model]);
  const derivedColumns = useMemo((): TrackerGridDerivedColumn[] => {
    const where = createItemWhereResolver({ placements: itemPlacements, pages, typeLabel, rootLabel, itemTitle });
    // Right after the title column (the type's title-role field): past the
    // field columns it falls off-screen at a normal width.
    const after = resolveRoleFieldName(typeId, 'title');
    return [{ id: '__where', label: 'Where', width: 220, after, value: (row) => where(row.id) }];
  }, [itemPlacements, pages, typeLabel, rootLabel, typeId, model, itemTitle]);

  return (
    <div className="type-page-tab-table flex flex-col" data-testid="type-page-table">
      <div className="type-page-tab-views flex items-center gap-1 border-b border-nim text-xs">
        <button type="button" onClick={onClearTemporaryView} className={`px-2.5 py-[7px] text-nim ${temporaryView ? '' : '-mb-px border-b-2 border-[var(--nim-primary)]'}`}>All</button>
        {temporaryView ? <span className="-mb-px border-b-2 border-[var(--nim-primary)] px-2.5 py-[7px] text-nim">{temporaryView.label || 'View'} · Unsaved view</span> : null}
      </div>
      {temporaryView ? <LazyPlacedViewEmbed key={JSON.stringify(temporaryView)} target={{ kind: 'type', typeId }} label={temporaryView.label} attrs={temporaryView.attrs} variant="page" onOpenItem={onOpenItem} /> : <TrackerViewEmbed view={view} variant="page" onOpenItem={onOpenItem} derivedColumns={derivedColumns} typeIds={typeIds} />}
    </div>
  );
}
