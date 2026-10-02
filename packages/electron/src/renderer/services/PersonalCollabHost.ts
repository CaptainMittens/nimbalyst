/**
 * Collaboration host for a workspace's Personal pages.
 *
 * Same seam as `ElectronCollabHost` so `CollabSidebar` and the docs session
 * run unchanged, but nothing here touches an account: the scope is fixed and
 * local, there is no team JWT and no member directory, and documents open as
 * `personal://<documentId>` tabs whose body lives in the local database.
 */

import {
  createPersonalCollabScope,
  type CollabArtifactRef,
  type CollabDocsCapability,
  type CollabDocsTreeState,
  type CollabDocsViewPreferences,
  type CollabDocumentTypeDescriptor,
  type CollabHost,
  type CollabOpenSource,
  type CollabScope,
  type TeamMemberSummary,
} from '@nimbalyst/collab-client/core';
import {
  getSharedDocumentDisplayName,
  getSharedDocumentsForScopeKey,
  type CollabDocsCommand,
  type CollabDocsCommandResult,
  type SharedDocument,
  type SharedFolder,
} from '@nimbalyst/collab-client/docs';
import { PERSONAL_PAGE_TAB_PREFIX } from '../contexts/TabsContext';
import { electronCollabDocumentAdapters } from './ElectronCollabHost';
import { errorNotificationService } from './ErrorNotificationService';
import { PersonalPagesDataSource } from './PersonalPagesDataSource';

type PersonalDocsCapability = CollabDocsCapability<
  SharedDocument,
  SharedFolder,
  CollabDocsCommand,
  CollabDocsCommandResult
>;

/** What a Personal artifact opens as: a personal page tab, or an item/type page. */
export type PersonalOpenTarget =
  | { kind: 'personal-page'; documentId: string; path: string; title: string }
  | Extract<CollabArtifactRef, { kind: 'tracker' } | { kind: 'type' }>;

export type PersonalOpenAdapter = (target: PersonalOpenTarget, source: CollabOpenSource) => void;

/** Tab path of a personal page. */
export function personalPageTabPath(documentId: string): string {
  return `${PERSONAL_PAGE_TAB_PREFIX}${documentId}`;
}

interface PersonalPagesWorkspaceState {
  personalPagesDiscovery?: Partial<CollabDocsViewPreferences>;
  personalPagesTree?: Partial<CollabDocsTreeState>;
}

/**
 * A personal page tab renders a markdown body from the local database, so
 * only markdown is offered until other editors can read a local body.
 */
// The sidebar reads this through `useSyncExternalStore`, which treats a new
// array identity as a changed snapshot on every render. Cache per source list
// so the identity only changes when the catalog does.
let personalTypesSource: readonly CollabDocumentTypeDescriptor[] | null = null;
let personalTypesCached: readonly CollabDocumentTypeDescriptor[] = [];
function personalDocumentTypes(): readonly CollabDocumentTypeDescriptor[] {
  const source = electronCollabDocumentAdapters.documentTypes();
  if (source !== personalTypesSource) {
    personalTypesSource = source;
    personalTypesCached = source.filter((descriptor) => descriptor.documentType === 'markdown');
  }
  return personalTypesCached;
}

async function readWorkspaceState(workspacePath: string): Promise<PersonalPagesWorkspaceState | null> {
  return (await window.electronAPI?.invoke?.('workspace:get-state', workspacePath)) ?? null;
}

export class PersonalCollabHost implements CollabHost<PersonalDocsCapability> {
  readonly surface = 'desktop' as const;
  readonly scope: CollabScope;
  readonly personalState = { status: 'unavailable' as const };
  readonly documents: PersonalDocsCapability;
  private openAdapter: PersonalOpenAdapter | null = null;

  constructor(readonly workspacePath: string) {
    this.scope = createPersonalCollabScope(workspacePath);
    this.documents = {
      dataSource: this.createDataSource(),
      // Kept beside the team's settings in the same workspace state, under
      // their own keys, so the two sections never overwrite each other.
      loadViewPreferences: async () => {
        const discovery = (await readWorkspaceState(workspacePath))?.personalPagesDiscovery;
        return {
          treeFilter: 'all',
          showUnreadBubbles: discovery?.showUnreadBubbles !== false,
        };
      },
      saveViewPreferences: async (_scopeKey, preferences) => {
        await window.electronAPI?.invoke?.('workspace:update-state', workspacePath, {
          personalPagesDiscovery: preferences,
        });
      },
      loadTreeState: async () => {
        const tree = (await readWorkspaceState(workspacePath))?.personalPagesTree;
        return {
          expandedFolders: Array.isArray(tree?.expandedFolders) ? tree.expandedFolders : [],
          userTouched: tree?.userTouched === true,
        };
      },
      saveTreeState: async (_scopeKey, treeState) => {
        await window.electronAPI?.invoke?.('workspace:update-state', workspacePath, {
          personalPagesTree: treeState,
        });
      },
      documentTypes: personalDocumentTypes,
      onDocumentTypesChanged: electronCollabDocumentAdapters.onDocumentTypesChanged,
      // The creation pipeline branches on the personal scope: it registers
      // the page locally and never seeds a room.
      createDocument: electronCollabDocumentAdapters.createDocument,
      readReceipts: { status: 'unavailable' },
    };
  }

  /**
   * The host outlives any one docs session, but a session disposes its source
   * on unmount and a disposed `PersonalPagesDataSource` never watches again.
   * Each dispose drops the instance so the next session gets a fresh one.
   */
  private createDataSource(): PersonalDocsCapability['dataSource'] {
    let current: PersonalPagesDataSource | null = null;
    const source = () => (current ??= new PersonalPagesDataSource(this.workspacePath));
    return {
      snapshot: () => source().snapshot(),
      subscribe: (cb) => source().subscribe(cb),
      command: (command) => source().command(command),
      status: () => 'connected',
      dispose: () => {
        current?.dispose();
        current = null;
      },
    };
  }

  async resolveScope(): Promise<CollabScope> {
    return this.scope;
  }

  onScopeChanged(): () => void {
    return () => undefined;
  }

  async getTeamJwt(): Promise<never> {
    throw new Error('Personal pages have no team');
  }

  async getMembers(): Promise<TeamMemberSummary[]> {
    return [];
  }

  openArtifact(ref: CollabArtifactRef, source: CollabOpenSource): void {
    if (!this.openAdapter) {
      throw new Error('Personal pages were opened without a navigation adapter');
    }
    if (ref.kind === 'tracker' || ref.kind === 'type') {
      this.openAdapter(ref, source);
      return;
    }
    if (ref.kind !== 'document') return;
    this.openAdapter({
      kind: 'personal-page',
      documentId: ref.documentId,
      path: personalPageTabPath(ref.documentId),
      title: this.documentTitle(ref.documentId),
    }, source);
  }

  artifactUrl(): string | null {
    // A personal page is on this device only; there is nothing to link to.
    return null;
  }

  setOpenArtifactAdapter(adapter: PersonalOpenAdapter): () => void {
    this.openAdapter = adapter;
    return () => {
      if (this.openAdapter === adapter) this.openAdapter = null;
    };
  }

  reportError(error: unknown, context: string): void {
    const resolved = error instanceof Error ? error : new Error(String(error));
    errorNotificationService.showFromError(resolved, context);
  }

  notify(notification: {
    level: 'info' | 'warning' | 'error';
    title: string;
    message: string;
    duration?: number;
  }): void {
    const options = notification.duration ? { duration: notification.duration } : undefined;
    if (notification.level === 'info') {
      errorNotificationService.showInfo(notification.title, notification.message, options);
    } else if (notification.level === 'warning') {
      errorNotificationService.showWarning(notification.title, notification.message, options);
    } else {
      errorNotificationService.showError(notification.title, notification.message);
    }
  }

  /** Tab title of a personal page: its leaf name, without the folder path. */
  documentTitle(documentId: string): string {
    const document = getSharedDocumentsForScopeKey(this.scope.scopeKey)
      .find((candidate) => candidate.documentId === documentId);
    return getSharedDocumentDisplayName(document?.title ?? '', documentId);
  }
}
