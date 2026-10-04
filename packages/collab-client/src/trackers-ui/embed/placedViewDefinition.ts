/**
 * A placed view's definition, read from its link title (Decision 22: the
 * definition lives in the page, not in a saved-view record).
 *
 *   cols=title,devFirst,realtime     visible columns, in order
 *   sort=realtime:desc               sort column and direction
 *   filter=status:open|active,tier:1 one clause per field; `|` = any of
 *   mode=2x2 x=<field> y=<field>     a 2x2 of two number fields
 *   xl= yl= q=TL|TR|BL|BR            axis and quadrant labels (percent-encoded)
 *   pin=Label@0.85,0.9;Other@0.2,0.3 extra points drawn highlighted
 *
 * Unknown keys are ignored; a malformed value falls back to the default
 * rather than hiding the view.
 */

import { decodeViewAttrValue, type PlacedViewScope } from '@nimbalyst/runtime/core/placedViewUrl';
import type { QuadrantPin } from '@nimbalyst/runtime/editor/plugins/QuadrantPlugin/quadrantModel';
import type { TrackerFieldFilter } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { createDefaultViewDefinition, type SavedView } from '@nimbalyst/collab-client/trackers';

export interface PlacedQuadrant {
  xField: string;
  yField: string;
  xLabel?: string;
  yLabel?: string;
  quadrants?: string[];
  pins: QuadrantPin[];
}

export interface PlacedViewDefinition {
  view: SavedView;
  mode: 'table' | '2x2';
  quadrant?: PlacedQuadrant;
}

function list(value: string | undefined, separator: string): string[] {
  return (value ?? '').split(separator).map((part) => part.trim()).filter(Boolean);
}

function filterClauses(value: string | undefined): TrackerFieldFilter[] {
  return list(value, ',').flatMap((clause) => {
    const colon = clause.indexOf(':');
    if (colon <= 0) return [];
    const field = clause.slice(0, colon);
    const values = list(clause.slice(colon + 1), '|').map(decodeViewAttrValue);
    if (values.length === 0) return [];
    return [values.length === 1 ? { field, op: '=', value: values[0] } : { field, op: 'in', value: values }];
  });
}

function pins(value: string | undefined): QuadrantPin[] {
  return list(value, ';').flatMap((entry) => {
    const at = entry.lastIndexOf('@');
    if (at <= 0) return [];
    const [x, y] = entry.slice(at + 1).split(',').map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    return [{ label: decodeViewAttrValue(entry.slice(0, at)), x, y }];
  });
}

function label(value: string | undefined): string | undefined {
  return value ? decodeViewAttrValue(value) : undefined;
}

/**
 * The scopes a host's data source can show and write: its team project, and
 * whether `local` (the author's own items) means this page's items here.
 */
export interface PlacedViewReach {
  team: { orgId: string; projectId: string } | null;
  local: boolean;
}

/**
 * Whether a view of `scope` may be drawn from (and edit) the host's items. A
 * link without a scope predates console links and names no other project, so
 * it reads as the host's. With no reach declared, no scoped link is drawn.
 */
export function placedViewInReach(scope: PlacedViewScope | undefined, reach: PlacedViewReach | undefined): boolean {
  if (scope === undefined) return true;
  if (!reach) return false;
  if (scope === 'local') return reach.local;
  return reach.team !== null && reach.team.orgId === scope.orgId && reach.team.projectId === scope.projectId;
}

export function placedViewDefinition(
  typeId: string,
  name: string,
  attrs: Readonly<Record<string, string>>,
): PlacedViewDefinition {
  const [sortBy, direction] = list(attrs.sort, ':');
  const columns = list(attrs.cols, ',');
  const clauses = filterClauses(attrs.filter);
  const view: SavedView = {
    id: `placed:${typeId}`,
    name: name || typeId,
    definition: {
      ...createDefaultViewDefinition(),
      selectedType: typeId,
      viewMode: 'table',
      // A placed view shows what its filters say; it does not hide closed items on its own.
      statusScope: 'all',
      recentlyViewedDays: null,
      ...(sortBy ? { sortBy, sortDirection: direction === 'asc' ? 'asc' as const : 'desc' as const } : {}),
      columnConfig: columns.length > 0 ? { visibleColumns: columns, columnWidths: {} } : null,
      columnFilters: clauses.length > 0 ? { combinator: 'and', clauses } : null,
    },
  };
  if (attrs.mode !== '2x2' || !attrs.x || !attrs.y) return { view, mode: 'table' };
  const quadrants = list(attrs.q, '|').map(decodeViewAttrValue);
  return {
    view,
    mode: '2x2',
    quadrant: {
      xField: attrs.x,
      yField: attrs.y,
      ...(label(attrs.xl) ? { xLabel: label(attrs.xl) } : {}),
      ...(label(attrs.yl) ? { yLabel: label(attrs.yl) } : {}),
      ...(quadrants.length > 0 ? { quadrants } : {}),
      pins: pins(attrs.pin),
    },
  };
}
