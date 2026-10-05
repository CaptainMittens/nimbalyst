/**
 * A view placed in a page (a placed-view link of a type, see `placedViewUrl.ts`),
 * drawn live from the items. The definition comes from the link title
 * (`placedViewDefinition`): a table whose cells edit the items, or a 2x2 of
 * two number fields with pinned extra points.
 *
 * The host mounts it inside a `TrackersUIProvider`. Loaded lazily
 * (`LazyPlacedViewEmbed`) so a page with no view does not pay for the grid.
 */

import { useMemo, type JSX } from 'react';
import type { CollabOpenOptions } from '@nimbalyst/collab-client/core';
import { createPlacedViewUrl, type PlacedViewTarget } from '@nimbalyst/runtime/core/placedViewUrl';
import { QuadrantChart } from '@nimbalyst/runtime/editor/plugins/QuadrantPlugin/QuadrantChart';
import { globalRegistry } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import type { SavedView } from '@nimbalyst/collab-client/trackers';
import { useTrackersUI } from '../TrackersUIProvider';
import { useTrackerDataSelector } from '../useTrackerData';
import { useTrackerViewRows } from '../useTrackerViewRows';
import { TrackerViewEmbed } from './TrackerViewEmbed';
import { placedViewDefinition, placedViewInReach, type PlacedQuadrant, type PlacedViewReach } from './placedViewDefinition';
import { quadrantData } from './quadrantData';
import { PlacedViewNote } from './PlacedViewNote';
import { MarksListEmbed } from './MarksListEmbed';

export interface PlacedViewEmbedProps {
  target: PlacedViewTarget;
  label: string;
  attrs: Readonly<Record<string, string>>;
  /**
   * The scopes the mounted data source serves. A link naming any other scope
   * is never drawn from (or edited through) this host's items.
   */
  reach?: PlacedViewReach;
  onOpenItem?: (itemId: string, options?: CollabOpenOptions) => void;
  onOpenAsTable?: (view: SavedView) => void;
  /** Opens the page a listed mark is on, by its tab uri. */
  onOpenPage?: (uri: string, options?: CollabOpenOptions) => void;
  /** Opens the view's own console link, for a view this host cannot draw. */
  onOpenLink?: (href: string) => void;
}

function parseHeight(value: string | undefined): number | undefined {
  const parsed = value ? parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) ? Math.max(parsed, 120) : undefined;
}

export function PlacedViewEmbed({ target, label, attrs, reach, onOpenItem, onOpenAsTable, onOpenPage, onOpenLink }: PlacedViewEmbedProps): JSX.Element {
  if (!placedViewInReach(target.scope, reach)) {
    return <OutOfScopeViewNote target={target} label={label} onOpenLink={onOpenLink} />;
  }
  if (target.kind === 'marks') {
    return <MarksListEmbed kind={target.marks} label={label} attrs={attrs} onOpenPage={onOpenPage} />;
  }
  return <TypeViewEmbed typeId={target.typeId} label={label} attrs={attrs} onOpenItem={onOpenItem} onOpenAsTable={onOpenAsTable} />;
}

/** A view of another project (or of someone's own items, on a shared page): its link, never these items. */
function OutOfScopeViewNote({ target, label, onOpenLink }: {
  target: PlacedViewTarget;
  label: string;
  onOpenLink?: (href: string) => void;
}): JSX.Element {
  const href = createPlacedViewUrl(target);
  const name = label || (target.kind === 'type' ? target.typeId : 'View');
  const open = onOpenLink
    ? <button type="button" className="ml-1 text-nim-link hover:underline" data-testid="placed-view-open-link" onClick={() => onOpenLink(href)}>Open</button>
    : <a className="ml-1 text-nim-link hover:underline" data-testid="placed-view-open-link" href={href} target="_blank" rel="noreferrer">Open</a>;
  return (
    <div
      className="placed-view-out-of-scope my-3 rounded-lg border border-nim bg-nim-secondary px-3 py-2 text-xs text-nim-muted"
      contentEditable={false}
      data-testid="placed-view-out-of-scope"
    >
      {name}: a view from another project, so it is not shown here.{open}
    </div>
  );
}

function TypeViewEmbed({ typeId, label, attrs, onOpenItem, onOpenAsTable }: {
  typeId: string;
  label: string;
  attrs: Readonly<Record<string, string>>;
  onOpenItem?: (itemId: string, options?: CollabOpenOptions) => void;
  onOpenAsTable?: (view: SavedView) => void;
}): JSX.Element {
  const loaded = useTrackerDataSelector((state) => state.loaded);
  // Re-read when the attrs change; the object identity changes on every node update.
  const attrsKey = JSON.stringify(attrs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const placed = useMemo(() => placedViewDefinition(typeId, label, attrs), [typeId, label, attrsKey]);
  if (loaded && !globalRegistry.get(typeId)) {
    return <PlacedViewNote>{label || typeId}: there is no {typeId} type in this project.</PlacedViewNote>;
  }
  if (placed.mode === '2x2' && placed.quadrant) {
    return <QuadrantViewEmbed view={placed.view} quadrant={placed.quadrant} onOpenItem={onOpenItem} />;
  }
  return (
    <TrackerViewEmbed
      view={placed.view}
      height={parseHeight(attrs.height)}
      onOpenItem={onOpenItem}
      onOpenAsTable={onOpenAsTable}
    />
  );
}

function QuadrantViewEmbed({ view, quadrant, onOpenItem }: {
  view: SavedView;
  quadrant: PlacedQuadrant;
  onOpenItem?: (itemId: string, options?: CollabOpenOptions) => void;
}): JSX.Element {
  const { identity } = useTrackersUI();
  const records = useTrackerDataSelector((state) => state.records);
  const { rows } = useTrackerViewRows(records, view.definition, { identity });
  const data = useMemo(() => quadrantData(rows, quadrant), [rows, quadrant]);
  const placedCount = data.points.filter((point) => !point.pinned).length;
  return (
    <div
      className="placed-view-quadrant my-3 flex flex-col overflow-hidden rounded-lg border border-nim bg-nim-secondary"
      contentEditable={false}
      data-testid="placed-view-quadrant"
    >
      <div className="placed-view-quadrant-head flex items-center gap-2.5 border-b border-nim px-3 py-2 text-xs">
        <span className="font-medium text-nim">{view.name}</span>
        <span className="rounded bg-nim-tertiary px-2 py-0.5 font-mono text-[11px] text-nim-muted">
          {quadrant.xField} by {quadrant.yField}
        </span>
      </div>
      <div className="placed-view-quadrant-body bg-nim p-2">
        <QuadrantChart
          points={data.points}
          xLabel={quadrant.xLabel ?? quadrant.xField}
          yLabel={quadrant.yLabel ?? quadrant.yField}
          quadrants={quadrant.quadrants}
          onOpenPoint={onOpenItem}
        />
      </div>
      <div className="placed-view-quadrant-foot flex items-center gap-3.5 px-3 py-1.5 text-[11px] text-nim-faint">
        <span>{placedCount} placed</span>
        {data.skipped > 0 ? <span>{data.skipped} without both values</span> : null}
      </div>
    </div>
  );
}
