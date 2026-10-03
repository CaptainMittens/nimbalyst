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
import type { PlacedViewTarget } from '@nimbalyst/runtime/core/placedViewUrl';
import { QuadrantChart } from '@nimbalyst/runtime/editor/plugins/QuadrantPlugin/QuadrantChart';
import { globalRegistry } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import type { SavedView } from '@nimbalyst/collab-client/trackers';
import { useTrackersUI } from '../TrackersUIProvider';
import { useTrackerDataSelector } from '../useTrackerData';
import { useTrackerViewRows } from '../useTrackerViewRows';
import { TrackerViewEmbed } from './TrackerViewEmbed';
import { placedViewDefinition, type PlacedQuadrant } from './placedViewDefinition';
import { quadrantData } from './quadrantData';
import { PlacedViewNote } from './PlacedViewNote';
import { MarksListEmbed } from './MarksListEmbed';

export interface PlacedViewEmbedProps {
  target: PlacedViewTarget;
  label: string;
  attrs: Readonly<Record<string, string>>;
  onOpenItem?: (itemId: string) => void;
  onOpenAsTable?: (view: SavedView) => void;
  /** Opens the page a listed mark is on, by its tab uri. */
  onOpenPage?: (uri: string) => void;
}

function parseHeight(value: string | undefined): number | undefined {
  const parsed = value ? parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) ? Math.max(parsed, 120) : undefined;
}

export function PlacedViewEmbed({ target, label, attrs, onOpenItem, onOpenAsTable, onOpenPage }: PlacedViewEmbedProps): JSX.Element {
  if (target.kind === 'marks') {
    return <MarksListEmbed kind={target.marks} label={label} attrs={attrs} onOpenPage={onOpenPage} />;
  }
  return <TypeViewEmbed typeId={target.typeId} label={label} attrs={attrs} onOpenItem={onOpenItem} onOpenAsTable={onOpenAsTable} />;
}

function TypeViewEmbed({ typeId, label, attrs, onOpenItem, onOpenAsTable }: {
  typeId: string;
  label: string;
  attrs: Readonly<Record<string, string>>;
  onOpenItem?: (itemId: string) => void;
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
  onOpenItem?: (itemId: string) => void;
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
