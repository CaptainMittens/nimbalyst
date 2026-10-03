/**
 * The slash menu's entries for placing a view in a page: a table per type,
 * a 2x2 for a type with two number fields, and the decisions and open
 * questions lists. The menu itself is the picker; the placed link carries the
 * definition and can be edited in the markdown afterwards. Republished when
 * the project's types change.
 *
 * The inserted link is a console link for the page's own scope (Decision 23):
 * the insert command reads the page's document path and asks
 * `placedViewScopeForDocument` here.
 */

import type { UserCommand } from '@nimbalyst/runtime/editor/types/PluginTypes';
import { setExtensionContributions } from '@nimbalyst/runtime/editor/extensions/extensionContributionsStore';
import { setExtensionLexicalExtension } from '@nimbalyst/runtime/editor/extensions/extensionLexicalExtensionsStore';
import {
  INSERT_PLACED_VIEW_COMMAND,
  PlacedViewInsertExtension,
  setPlacedViewScopeResolver,
  type PlacedViewInsertPayload,
} from '@nimbalyst/runtime/editor/plugins/EmbedPlugin/placedViewInsert';
import type { PlacedViewScope } from '@nimbalyst/runtime/core/placedViewUrl';
import { store } from '@nimbalyst/runtime/store';
import { globalRegistry } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { trackerItemsMapAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerDataAtoms';
import type { TrackerDataModel } from '@nimbalyst/tracker-schema';
import { activeCollabScopeAtom } from '../../store/atoms/collabDocuments';
import { isTeamTrackerSharing } from '../Settings/panels/trackerConfigUpgrade';

type Lane = 'team' | 'personal';

export interface PlacedViewScopeLookups {
  /** The team project the window's Pages show, or null with no team. */
  team: { orgId: string; projectId: string } | null;
  itemLane(itemId: string): Lane;
  typeLane(typeId: string): Lane;
}

/**
 * The scope a page's placed views link under: a team page (shared document,
 * team typed page, team type page) names the team project; a Personal page,
 * Personal typed page or workspace file is `local`. Undefined when the page
 * is unknown or is the team's but no team project is open, so the insert
 * falls back to the app link rather than naming the wrong scope.
 */
export function placedViewScopeForDocument(path: string | null, lookups: PlacedViewScopeLookups): PlacedViewScope | undefined {
  if (!path) return undefined;
  const lane: Lane = path.startsWith('personal://') ? 'personal'
    : path.startsWith('collab://') ? 'team'
    : path.startsWith('tracker://') ? lookups.itemLane(path.slice('tracker://'.length))
    : path.startsWith('type://') ? lookups.typeLane(path.slice('type://'.length))
    : 'personal';
  if (lane === 'personal') return 'local';
  return lookups.team ?? undefined;
}

const typeLane = (typeId: string): Lane => {
  const model = globalRegistry.get(typeId);
  return model && isTeamTrackerSharing(model.sharing ?? 'personal') ? 'team' : 'personal';
};

function windowScopeLookups(): PlacedViewScopeLookups {
  const scope = store.get(activeCollabScopeAtom);
  const projectId = scope?.indexConfig.teamProjectId;
  return {
    team: scope && projectId ? { orgId: scope.orgId, projectId } : null,
    itemLane: (itemId) => {
      const record = store.get(trackerItemsMapAtom).get(itemId);
      return record ? typeLane(record.primaryType) : 'personal';
    },
    typeLane,
  };
}

const SOURCE = 'placed-view-embed';
const command = INSERT_PLACED_VIEW_COMMAND as UserCommand['command'];

function entry(title: string, description: string, icon: string, keywords: string[], payload: PlacedViewInsertPayload): UserCommand {
  return { title, description, icon, keywords: ['view', 'embed', ...keywords], command, payload };
}

export function buildPlacedViewCommands(models: readonly TrackerDataModel[]): UserCommand[] {
  const commands: UserCommand[] = [];
  for (const model of models) {
    const name = model.displayNamePlural || model.displayName || model.type;
    const target = { kind: 'type', typeId: model.type } as const;
    commands.push(entry(`Table: ${name}`, `A live table of ${name}; editing a cell edits the page`, 'table_view', ['table', name], { target, label: name }));
    const numbers = model.fields.filter((field) => field.type === 'number');
    if (numbers.length >= 2) {
      commands.push(entry(`2x2: ${name}`, `${name} placed by ${numbers[0].name} and ${numbers[1].name}`, 'grid_view', ['2x2', 'quadrant', 'chart', name], {
        target,
        label: name,
        attrs: { mode: '2x2', x: numbers[0].name, y: numbers[1].name },
      }));
    }
  }
  commands.push(
    entry('Decisions list', 'Every sentence marked decided, across pages', 'gavel', ['decisions', 'decided', 'marks'], {
      target: { kind: 'marks', marks: 'decided' }, label: 'Decisions',
    }),
    entry('Open questions list', 'Every sentence marked open, across pages', 'help', ['open', 'questions', 'marks'], {
      target: { kind: 'marks', marks: 'open' }, label: 'Open questions',
    }),
  );
  return commands;
}

export function registerPlacedViewCommands(): () => void {
  setExtensionLexicalExtension(SOURCE, PlacedViewInsertExtension);
  setPlacedViewScopeResolver((path) => placedViewScopeForDocument(path, windowScopeLookups()));
  const publish = () => {
    setExtensionContributions(SOURCE, { userCommands: buildPlacedViewCommands(globalRegistry.getListed()) });
  };
  publish();
  return globalRegistry.onChange(publish);
}
