// @vitest-environment node
import { expect, test } from 'vitest';
import type { LabelRegistry } from '@nimbalyst/tracker-schema';
import { buildLabelIndex, effectiveLabelRegistry, recordRole } from '../ontologyLabels';
import { buildLabelMap } from '../ontologyLabelMap';
import { buildTypePageModel } from '../ontologyTypePage';
import { claim, knowledgeFixture, NOW, rec, ref } from './ontologyFixture';

const REGISTRY: LabelRegistry = {
  labels: [
    { id: 'capability', label: 'Capability', properties: ['owner-team', 'depends-on'] },
    { id: 'user-facing', label: 'User-facing', properties: ['surface'] },
    { id: 'feature', label: 'Feature', broader: ['capability', 'user-facing'], properties: ['flag', 'annual-revenue'] },
    { id: 'invariant', label: 'Invariant', properties: ['severity'] },
    { id: 'subsystem', label: 'Subsystem' },
  ],
  properties: [
    { id: 'owner-team', label: 'Owner team', type: 'string' },
    { id: 'surface', label: 'Surface', type: 'select', options: ['desktop', 'web'] },
    { id: 'flag', label: 'Flag', type: 'string', qualifiers: { since: { valueShape: 'text' } } as never },
    { id: 'severity', label: 'Severity', type: 'string' },
  ],
  claimProperties: { 'depends-on': { range: ['subsystem'] } },
};

const RECORDS = [
  rec('Sync', 'entity', { labels: ['subsystem'] }),
  rec('Search', 'entity', { labels: ['feature'], 'owner-team': 'core', surface: 'web', flag: { value: 'search-v2', qualifiers: { since: '2026-01' } }, severity: 'never shown' }),
  rec('Undo', 'entity', { labels: ['capability', 'invariant'] }),
  rec('Offline', 'entity', { labels: ['invariant'] }),
  claim('old', 'Search', 'annual-revenue', undefined, { valueText: '$1M', qualifiers: { asOf: '2025-01-01' } }),
  claim('new', 'Search', 'annual-revenue', undefined, { valueText: '$2M', qualifiers: { asOf: '2026-01-01' } }),
  claim('retracted', 'Search', 'annual-revenue', undefined, { valueText: '$9M', qualifiers: { asOf: '2026-06-01' }, status: 'withdrawn' }),
  claim('dep', 'Search', 'depends-on', 'Sync'),
];

const options = { predicateIds: ['annual-revenue', 'depends-on'], now: new Date(NOW) };

test('rows include pages under narrower labels; columns are own then ancestors, never a row\'s other labels', () => {
  const capability = buildTypePageModel(REGISTRY, 'capability', RECORDS, options);
  // Search is a feature, which is under capability; Undo also carries invariant.
  expect(capability.rows.map((row) => row.record.id)).toEqual(['Search', 'Undo']);
  expect(capability.columns.map((column) => column.id)).toEqual(['owner-team', 'depends-on']);

  const feature = buildTypePageModel(REGISTRY, 'feature', RECORDS, options);
  expect(feature.columns.map((column) => [column.id, column.storage, column.viaLabel])).toEqual([
    ['flag', 'field', 'feature'],
    ['annual-revenue', 'claim', 'feature'],
    ['owner-team', 'field', 'capability'],
    ['depends-on', 'claim', 'capability'],
    ['surface', 'field', 'user-facing'],
  ]);
  expect(feature.properties.find((property) => property.id === 'surface')).toMatchObject({ inheritedFrom: 'user-facing', options: ['desktop', 'web'] });
  expect(feature.relationsOut).toEqual([{ property: 'depends-on', name: 'depends on', from: 'capability', to: ['subsystem'] }]);
  expect(buildTypePageModel(REGISTRY, 'subsystem', RECORDS, options).relationsIn.map((relation) => relation.from)).toEqual(['capability']);
});

test('a claim cell is the latest asserted asOf and flags a stale fact; entity-valued cells name their targets', () => {
  const [search] = buildTypePageModel(REGISTRY, 'feature', RECORDS, options).rows;
  // The withdrawn claim is newer but not asserted.
  expect(search!.cells['annual-revenue']).toMatchObject({ storage: 'claim', claimId: 'new', text: '$2M', asOf: '2026-01-01', stale: true });
  expect(search!.cells['depends-on']).toMatchObject({ storage: 'claim', claimId: 'dep', text: '', targetIds: ['Sync'] });
  // A qualified field keeps its value and qualifiers apart.
  expect(search!.cells.flag).toMatchObject({ value: 'search-v2', text: 'search-v2', qualifiers: { since: '2026-01' } });
  const fresh = buildTypePageModel(REGISTRY, 'feature', [...RECORDS, claim('newest', 'Search', 'annual-revenue', undefined, { valueText: '$3M', qualifiers: { asOf: '2026-09-01' } })], options);
  expect(fresh.rows[0]!.cells['annual-revenue']).toMatchObject({ claimId: 'newest', stale: false });
});

test('with no registry the kinds stand in as labels, with their roles, and the map counts pages', () => {
  const records = knowledgeFixture();
  const registry = effectiveLabelRegistry(null, { observedKinds: ['concept'] });
  const byId = new Map(records.map((record) => [record.id, record]));
  expect(recordRole(registry, byId.get('Markets')!)).toBe('structure');
  expect(recordRole(registry, byId.get('AI IDE')!)).toBe('market-node');
  expect(recordRole(registry, byId.get('Cursor')!)).toBe('page');

  const map = buildLabelMap(buildLabelIndex(registry, records));
  expect(map.nodes.map((node) => [node.id, node.count])).toEqual([
    ['market', 3], ['product', 4], ['organization', 1], ['concept', 2],
  ]);
  expect(map.structure.map((node) => node.id)).toEqual(['home', 'area']);
  expect(map.edges.filter((edge) => edge.kind === 'range').map((edge) => edge.id)).toEqual([
    'range:product.in-market>market', 'range:product.made-by>organization', 'range:product.competes-with>product',
  ]);
  // A registry with entries replaces the stand-in entirely.
  expect(effectiveLabelRegistry(REGISTRY)).toBe(REGISTRY);
  expect(buildLabelIndex(REGISTRY, [rec('x', 'entity', { labels: ['mystery'] }), rec('y', 'entity', {})]).undeclared).toEqual(['mystery']);
  expect(buildLabelIndex(REGISTRY, [rec('y', 'entity', { parent: ref('x') })]).unlabeled.map((record) => record.id)).toEqual(['y']);
});
