/**
 * Tracker item pages (`tracker://<itemId>`), type pages (`type://<typeId>`) and
 * personal pages (`personal://<documentId>`)
 * open as tabs inside Pages mode's own tab strip, beside shared documents. This
 * module maps between those tabs, the artifact refs that open them, and the
 * entries that persist them across a restart.
 */

import { globalRegistry } from '@nimbalyst/tracker-schema';
import {
  PERSONAL_PAGE_TAB_PREFIX,
  TYPE_TAB_PREFIX,
  isPersonalPageTabPath,
  isTrackerTabPath,
  isTypeTabPath,
  type TabData,
} from '../../contexts/TabsContext';
import type {
  PersistedCollabPageEntry,
  PersistedCollabPageKind,
} from '../../utils/collabOpenDocsPersistence';

const TRACKER_TAB_PREFIX = 'tracker://';

const PAGE_TAB_PREFIX: Record<PersistedCollabPageKind, string> = {
  tracker: TRACKER_TAB_PREFIX,
  type: TYPE_TAB_PREFIX,
  personal: PERSONAL_PAGE_TAB_PREFIX,
};

function pageKindOf(filePath: string): PersistedCollabPageKind | null {
  if (isTypeTabPath(filePath)) return 'type';
  if (isTrackerTabPath(filePath)) return 'tracker';
  if (isPersonalPageTabPath(filePath)) return 'personal';
  return null;
}

type AddTab = (
  filePath: string,
  content?: string,
  switchToTab?: boolean,
  displayName?: string,
  initialState?: Pick<TabData, 'isPinned'>,
) => string | null;

export function pageTabPath(kind: PersistedCollabPageEntry['kind'], artifactId: string): string {
  return `${PAGE_TAB_PREFIX[kind]}${artifactId}`;
}

/** The type's plural name, or its id until the schema registry knows it. */
export function typePageTitle(typeId: string): string {
  return globalRegistry.get(typeId)?.displayNamePlural || typeId;
}

export function openPageTab(
  addTab: AddTab,
  page: Pick<PersistedCollabPageEntry, 'kind' | 'artifactId'> & Partial<PersistedCollabPageEntry>,
): string | null {
  const title = page.title ?? (page.kind === 'type' ? typePageTitle(page.artifactId) : undefined);
  return addTab(
    pageTabPath(page.kind, page.artifactId),
    '',
    true,
    title,
    page.isPinned === undefined ? undefined : { isPinned: page.isPinned },
  );
}

/** The persisted form of an item, type or personal page tab; null for any other tab. */
export function toPersistedPageEntry(tab: TabData): PersistedCollabPageEntry | null {
  const kind = pageKindOf(tab.filePath);
  if (!kind) return null;
  const artifactId = tab.filePath.slice(pageTabPath(kind, '').length);
  if (!artifactId) return null;
  // An item tab's fileName is its id until a title was passed in; the tab bar
  // resolves the live title, so an id is not worth keeping as one.
  const title = tab.fileName && tab.fileName !== artifactId ? tab.fileName : undefined;
  return {
    kind,
    artifactId,
    ...(title ? { title } : {}),
    isPinned: tab.isPinned,
  };
}
