// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { TrackerDataModel } from '@nimbalyst/tracker-schema';
import { buildCollabTypeResolver } from '../collabTypeResolver';

const model = (type: string, sharing: 'team' | 'personal'): TrackerDataModel =>
  ({ type, displayName: type, displayNamePlural: `${type}s`, icon: 'table', sharing }) as unknown as TrackerDataModel;

describe('buildCollabTypeResolver', () => {
  it('offers and names only team-shared types, so a teammate never gets a placement they cannot resolve', () => {
    const models = [model('module', 'team'), model('scratch', 'personal')];
    const resolver = buildCollabTypeResolver(
      { get: (type) => models.find((candidate) => candidate.type === type), getListed: () => models },
      new Map(),
    );

    expect(resolver.listedTypes?.().map((type) => type.typeId)).toEqual(['module']);
    expect(resolver.typeName('module')).toBe('modules');
    expect(resolver.typeName('scratch')).toBeNull();
  });

  it('offers only personal types, with their items, in the personal lane', () => {
    const models = [model('module', 'team'), model('scratch', 'personal')];
    const records = new Map([
      ['r1', { id: 'r1', primaryType: 'scratch', fields: { title: 'Idea' } }],
      ['r2', { id: 'r2', primaryType: 'module', fields: { title: 'Sync' } }],
    ]) as any;
    const resolver = buildCollabTypeResolver(
      { get: (type) => models.find((candidate) => candidate.type === type), getListed: () => models },
      records,
      'personal',
    );

    expect(resolver.listedTypes?.().map((type) => type.typeId)).toEqual(['scratch']);
    expect(resolver.typeName('module')).toBeNull();
    expect(resolver.itemsOfType('scratch').map((item) => item.itemId)).toEqual(['r1']);
    expect(resolver.itemsOfType('module')).toEqual([]);
  });
});
