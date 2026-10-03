// @vitest-environment node
/**
 * A placed view's definition comes from its link title, and its 2x2 places
 * items by two number fields.
 */

import { describe, expect, it } from 'vitest';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { quadrantData } from '../quadrantData';
import { placedViewDefinition } from '../placedViewDefinition';

function competitor(id: string, fields: Record<string, unknown>): TrackerRecord {
  return {
    id, primaryType: 'competitor', typeTags: ['competitor'], source: 'native', archived: false, syncStatus: 'local',
    system: { workspace: '/w', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
    fields,
  } as unknown as TrackerRecord;
}

describe('quadrantData', () => {
  it('places items by two number fields, skips missing values, keeps pinned points', () => {
    const data = quadrantData(
      [
        competitor('sf', { title: 'Salesforce', devFirst: 0.15, realtime: 0.85 }),
        competitor('ph', { title: 'PostHog', devFirst: '0.9', realtime: 0.3 }),
        competitor('nx', { title: 'No score', devFirst: 0.5 }),
        competitor('bad', { title: 'Bad', devFirst: 'high', realtime: 0.2 }),
      ],
      { xField: 'devFirst', yField: 'realtime', pins: [{ label: 'UserCurrent', x: 0.85, y: 0.9 }] },
    );
    expect(data.points).toEqual([
      { id: 'sf', label: 'Salesforce', x: 0.15, y: 0.85, pinned: false },
      { id: 'ph', label: 'PostHog', x: 0.9, y: 0.3, pinned: false },
      { id: 'pin:0', label: 'UserCurrent', x: 0.85, y: 0.9, pinned: true },
    ]);
    expect(data.skipped).toBe(2);
  });
});

describe('placedViewDefinition', () => {
  it('reads columns, sort and filters into a view of the type', () => {
    const placed = placedViewDefinition('competitor', 'Competitors', {
      cols: 'title,devFirst,realtime', sort: 'realtime:asc', filter: 'status:open|active,tier:1',
    });
    expect(placed.mode).toBe('table');
    expect(placed.view.name).toBe('Competitors');
    expect(placed.view.definition).toMatchObject({
      selectedType: 'competitor',
      viewMode: 'table',
      statusScope: 'all',
      sortBy: 'realtime',
      sortDirection: 'asc',
      columnConfig: { visibleColumns: ['title', 'devFirst', 'realtime'], columnWidths: {} },
      columnFilters: { combinator: 'and', clauses: [
        { field: 'status', op: 'in', value: ['open', 'active'] },
        { field: 'tier', op: '=', value: '1' },
      ] },
    });
  });

  it('reads a 2x2 with axis labels, quadrant labels and pins', () => {
    const placed = placedViewDefinition('competitor', 'Landscape', {
      mode: '2x2', x: 'devFirst', y: 'realtime',
      xl: 'Developer-first%2C%20open', yl: 'Realtime',
      q: 'Enterprise%20suites|Opportunity|Guidance|Dev-first',
      pin: 'UserCurrent@0.85,0.9;Bad@x,1',
    });
    expect(placed.mode).toBe('2x2');
    expect(placed.quadrant).toEqual({
      xField: 'devFirst', yField: 'realtime',
      xLabel: 'Developer-first, open', yLabel: 'Realtime',
      quadrants: ['Enterprise suites', 'Opportunity', 'Guidance', 'Dev-first'],
      pins: [{ label: 'UserCurrent', x: 0.85, y: 0.9 }],
    });
  });

  it('falls back to a table when a 2x2 names no axes', () => {
    expect(placedViewDefinition('competitor', 'C', { mode: '2x2' }).mode).toBe('table');
  });
});
