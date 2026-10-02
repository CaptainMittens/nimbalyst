import type { CollabTypeTreeResolver } from '@nimbalyst/collab-client/docs';
import type { TrackerDataModel } from '@nimbalyst/tracker-schema';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { getRecordTitle } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';
import { isTeamTrackerSharing } from '../Settings/panels/trackerConfigUpgrade';

type ResolvedItem = { itemId: string; title: string; sortKey: number | string };

export interface CollabTypeRegistry {
  get(type: string): TrackerDataModel | undefined;
  getListed(): TrackerDataModel[];
}

/** Which Pages section a resolver serves. */
export type CollabTypeLane = 'team' | 'personal';

/**
 * Each section offers and names only its own types. A team placement of a
 * personal type would reach teammates who do not have that schema, and their
 * tree would skip it as unknown; a team type placed in Personal pages would
 * file shared items under a section that claims to be private.
 */
export function buildCollabTypeResolver(
  registry: CollabTypeRegistry,
  records: ReadonlyMap<string, TrackerRecord>,
  lane: CollabTypeLane = 'team',
): CollabTypeTreeResolver {
  const inLane = (model: TrackerDataModel): boolean =>
    isTeamTrackerSharing(model.sharing ?? 'personal') === (lane === 'team');
  const laneModel = (typeId: string): TrackerDataModel | undefined => {
    const model = registry.get(typeId);
    return model && inLane(model) ? model : undefined;
  };

  const itemsByType = new Map<string, ResolvedItem[]>();
  const itemById = new Map<string, { itemId: string; title: string; typeId: string }>();
  for (const record of records.values()) {
    if (record.archived) continue;
    const list = itemsByType.get(record.primaryType) ?? [];
    const title = getRecordTitle(record).trim();
    list.push({ itemId: record.id, title, sortKey: record.issueNumber ?? title });
    itemsByType.set(record.primaryType, list);
    itemById.set(record.id, { itemId: record.id, title, typeId: record.primaryType });
  }
  for (const list of itemsByType.values()) {
    list.sort((left, right) =>
      typeof left.sortKey === 'number' && typeof right.sortKey === 'number'
        ? left.sortKey - right.sortKey
        : String(left.sortKey).localeCompare(String(right.sortKey), undefined, { numeric: true }));
  }

  return {
    typeName: (typeId) => {
      const model = laneModel(typeId);
      return model ? (model.displayNamePlural || model.displayName || typeId) : null;
    },
    typeLabel: (typeId) => {
      const model = laneModel(typeId);
      return model ? (model.displayName || typeId) : null;
    },
    typeExtends: (typeId) => registry.get(typeId)?.extends ?? null,
    // A placed typed page from the other lane is unknown here, like its type.
    item: (itemId) => {
      const item = itemById.get(itemId);
      return item && laneModel(item.typeId) ? item : null;
    },
    itemsOfType: (typeId) => (laneModel(typeId) ? itemsByType.get(typeId) ?? [] : []),
    listedTypes: () => registry.getListed()
      .filter(inLane)
      .map((model) => ({
        typeId: model.type,
        name: model.displayNamePlural || model.displayName || model.type,
        icon: model.icon,
      })),
  };
}
