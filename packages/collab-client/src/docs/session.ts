import { atom, type Atom, type WritableAtom } from 'jotai';
import { atomFamily } from 'jotai-family';
import { store } from '@nimbalyst/runtime/store';
import {
  isEntityUnread,
  mergeReceipt,
  type ReadReceipt,
  type UnreadEntitySnapshot,
} from '@nimbalyst/runtime/readReceipts/readReceipts';
import {
  CollabScopeResolutionError,
  isPersonalCollabScope,
  type CollabDocsCapability,
  type CollabHost,
  type CollabPersonalStateRow,
  type CollabScope,
} from '@nimbalyst/collab-client/core';
import { classifyChangedDocs, selectFavoriteDocs, selectRecentDocs, type ChangedSharedDoc } from './collabDiscovery';
import {
  collectFolderSubtree,
  computeLegacyFolderRenameUpdates,
  getCollabNodeName,
  getCollabParentPath,
  isDescendantFolder,
  normalizeCollabPath,
  planPageRemoval,
  projectPagesAsFolders,
  TYPE_PAGE_DOCUMENT_PREFIX,
} from './collabTree';
import type { CollabDocsCommand, CollabDocsDataChange, CollabDocsDataSource } from './dataSource';
import type { SharedDocument, SharedFolder, SharedItemPlacement, SharedTypePlacement } from './types';

export type CollabTreeFilter = 'all' | 'favorites' | 'updated';
/** Outcome of a placement write, once the store has confirmed or refused it. */
export type CollabPlacementWriteResult = { ok: true } | { ok: false; error: string };
export type CollabDocsUIStatus = 'disconnected' | 'connecting' | 'syncing' | 'connected' | 'error';

export interface CollabDiscoveryState {
  favorites?: string[];
  openedAt?: Record<string, number>;
  treeFilter: CollabTreeFilter;
  showUnreadBubbles: boolean;
  personalStateMigrationStartedAt?: number;
  personalStateMigratedAt?: number;
}

export interface PendingCollabFolder {
  scopeKey: string;
  orgId: string;
  folderId: string;
}

type DocsCapability = CollabDocsCapability<
  SharedDocument,
  SharedFolder,
  import('./dataSource').CollabDocsCommand,
  import('./dataSource').CollabDocsCommandResult
>;
type DocsHost = CollabHost<DocsCapability> & { documents: DocsCapability };

type ListUpdate<T> = T[] | ((current: T[]) => T[]);
type ListAtom<T> = WritableAtom<T[], [ListUpdate<T>], void>;

const documentsByScope = atomFamily((_scopeKey: string) => atom<SharedDocument[]>([]));
const foldersByScope = atomFamily((_scopeKey: string) => atom<SharedFolder[]>([]));
const typePlacementsByScope = atomFamily((_scopeKey: string) => atom<SharedTypePlacement[]>([]));
const itemPlacementsByScope = atomFamily((_scopeKey: string) => atom<SharedItemPlacement[]>([]));
/** Set from the snapshot: the store has turned folders into pages. */
const pageTreeByScope = atomFamily((_scopeKey: string) => atom(false));
/**
 * The folder list a scope's readers see. In a page tree every page can be a
 * parent, so the pages themselves stand in as folders (paths, crumbs, pickers
 * and the create flow all resolve parents through this list). Writes go to the
 * stored containers.
 */
const visibleFoldersByScope = atomFamily((scopeKey: string) => {
  // Keep the previous projection while no page changed id, name or parent, so
  // a body edit bumping `updatedAt` does not re-render every folder reader.
  let previousPages: SharedFolder[] = [];
  return atom<SharedFolder[], [ListUpdate<SharedFolder>], void>(
    (get) => {
      if (!get(pageTreeByScope(scopeKey))) return get(foldersByScope(scopeKey));
      const pages = projectPagesAsFolders(get(documentsByScope(scopeKey)));
      const unchanged = pages.length === previousPages.length && pages.every((page, index) => {
        const previous = previousPages[index];
        return previous.folderId === page.folderId
          && previous.name === page.name
          && (previous.parentFolderId ?? null) === (page.parentFolderId ?? null)
          && previous.decryptFailed === page.decryptFailed;
      });
      if (!unchanged) previousPages = pages;
      return previousPages;
    },
    (get, set, update) => {
      const target = foldersByScope(scopeKey);
      set(target, typeof update === 'function' ? update(get(target)) : update);
    },
  );
});
const statusByScope = atomFamily((_scopeKey: string) => atom<CollabDocsUIStatus>('disconnected'));
const hasTeamByScope = atomFamily((_scopeKey: string) => atom(false));
const orgIdByScope = atomFamily((_scopeKey: string) => atom<string | null>(null));
const userIdByScope = atomFamily((_scopeKey: string) => atom<string | null>(null));
const favoritesByScope = atomFamily((_scopeKey: string) => atom<string[]>([]));
const favoriteUpdatedAtByScope = atomFamily((_scopeKey: string) => atom<Record<string, number>>({}));
const openedAtByScope = atomFamily((_scopeKey: string) => atom<Record<string, number>>({}));
const treeFilterByScope = atomFamily((_scopeKey: string) => atom<CollabTreeFilter>('all'));
const showUnreadByScope = atomFamily((_scopeKey: string) => atom(true));
const personalStateScopeByScope = atomFamily((_scopeKey: string) => atom<string | null>(null));
const receiptsByScope = atomFamily((_scopeKey: string) => atom<Map<string, ReadReceipt>>(new Map()));
const pendingRemoteReceiptsByOrg = atomFamily((_orgId: string) => atom<Map<string, ReadReceipt>>(new Map()));
const unreadByScopeAndDocument = atomFamily((_key: string) => atom(false));
const unreadDocumentIdsByScope = new Map<string, Set<string>>();
const EMPTY_RECEIPTS = new Map<string, ReadReceipt>();
const sessionsByScope = new Map<string, CollabDocsSessionImpl>();

const activeCollabScopeStateAtom = atom<CollabScope | null>(null);

/** Stable desktop compatibility selector over the package-owned active scope. */
export const activeCollabScopeAtom = atom<CollabScope | null, [CollabScope | null], void>(
  (get) => get(activeCollabScopeStateAtom),
  (get, set, scope) => {
    if (scope && sessionsByScope.get(scope.scopeKey)?.uiCapabilities.readReceipts !== false) {
      const pendingTarget = pendingRemoteReceiptsByOrg(scope.orgId);
      const pending = get(pendingTarget);
      if (pending.size > 0) {
        const receiptsTarget = receiptsByScope(scope.scopeKey);
        const receipts = new Map(get(receiptsTarget));
        let unreadByOrg = get(docUnreadByOrgAtom);
        let unreadIds = unreadDocumentIdsByScope.get(scope.scopeKey);
        if (!unreadIds) {
          unreadIds = new Set();
          unreadDocumentIdsByScope.set(scope.scopeKey, unreadIds);
        }
        for (const [documentId, receipt] of pending) {
          receipts.set(documentId, mergeReceipt(receipts.get(documentId), receipt));
          unreadIds.add(documentId);
          set(unreadByScopeAndDocument(unreadKey(scope.scopeKey, documentId)), false);
          unreadByOrg = setOrgUnread(unreadByOrg, scope.orgId, documentId, false);
        }
        set(receiptsTarget, receipts);
        set(docUnreadByOrgAtom, unreadByOrg);
        pendingRemoteReceiptsByOrg.remove(scope.orgId);
      }
    }
    set(activeCollabScopeStateAtom, scope);
  },
);

function activeListAtom<T>(family: (scopeKey: string) => WritableAtom<T[], [ListUpdate<T>], void>): ListAtom<T> {
  return atom(
    (get) => {
      const scope = get(activeCollabScopeAtom);
      return scope ? get(family(scope.scopeKey)) : [];
    },
    (get, set, update) => {
      const scope = get(activeCollabScopeAtom);
      if (!scope) return;
      const target = family(scope.scopeKey);
      set(target, typeof update === 'function' ? update(get(target)) : update);
    },
  );
}

export const allSharedDocumentsAtom = activeListAtom(documentsByScope);
export const sharedDocumentsAtom = atom<SharedDocument[], [ListUpdate<SharedDocument>], void>(
  (get) => get(allSharedDocumentsAtom).filter((document) => document.trashedAt == null),
  (get, set, update) => {
    set(allSharedDocumentsAtom, typeof update === 'function'
      ? update(get(allSharedDocumentsAtom))
      : update);
  },
);
export const trashedSharedDocumentsAtom = atom((get) =>
  get(allSharedDocumentsAtom)
    .filter((document) => document.trashedAt != null)
    .sort((left, right) => (right.trashedAt ?? 0) - (left.trashedAt ?? 0)),
);

/**
 * The readable documents of one scope, whether or not it is the active one.
 *
 * `sharedDocumentsAtom` answers for the scope the window is *browsing*, which
 * a window that never mounts a Shared Docs surface never sets -- the
 * organization window is exactly that, so the active list is permanently empty
 * there. A window that holds a scope key of its own and needs the list for
 * something other than browsing it, such as resolving a document reference
 * inside a message, addresses the scope directly through this.
 *
 * Reactive, unlike `getSharedDocumentsForScopeKey`, so a document shared after
 * a reference was rendered still reaches the reference.
 */
export const sharedDocumentsForScopeAtom = atomFamily((scopeKey: string) =>
  atom((get) => get(documentsByScope(scopeKey)).filter((document) => document.trashedAt == null)),
);
export const sharedFoldersAtom = activeListAtom(visibleFoldersByScope);
/** Tracker types placed in the active scope's page tree, one per type. */
export const sharedTypePlacementsAtom = activeListAtom(typePlacementsByScope);
export const teamSyncStatusAtom = atom<CollabDocsUIStatus, [CollabDocsUIStatus], void>(
  (get) => {
    const scope = get(activeCollabScopeAtom);
    return scope ? get(statusByScope(scope.scopeKey)) : 'disconnected';
  },
  (get, set, value) => {
    const scope = get(activeCollabScopeAtom);
    if (scope) set(statusByScope(scope.scopeKey), value);
  },
);
export const workspaceHasTeamAtom = atom<boolean, [boolean], void>(
  (get) => {
    const scope = get(activeCollabScopeAtom);
    return scope ? get(hasTeamByScope(scope.scopeKey)) : false;
  },
  (get, set, value) => {
    const scope = get(activeCollabScopeAtom);
    if (scope) set(hasTeamByScope(scope.scopeKey), value);
  },
);
export const activeTeamOrgIdAtom = atom((get) => {
  const scope = get(activeCollabScopeAtom);
  return scope ? get(orgIdByScope(scope.scopeKey)) : null;
});
export const activeTeamUserIdAtom = atom((get) => {
  const scope = get(activeCollabScopeAtom);
  return scope ? get(userIdByScope(scope.scopeKey)) : null;
});
export const pendingCollabFolderAtom = atom<PendingCollabFolder | null>(null);
export const addSharedDocumentAtom = atom(null, (_get, set, document: SharedDocument) => {
  set(sharedDocumentsAtom, (current) => [
    document,
    ...current.filter((candidate) => candidate.documentId !== document.documentId),
  ]);
});

export const collabFavoritesAtom = atom((get) => {
  const scope = get(activeCollabScopeAtom);
  return scope ? get(favoritesByScope(scope.scopeKey)) : [];
});
export const docOpenedAtAtom = atom((get) => {
  const scope = get(activeCollabScopeAtom);
  return scope ? get(openedAtByScope(scope.scopeKey)) : {};
});
export const collabTreeFilterAtom = atom<CollabTreeFilter, [CollabTreeFilter], void>(
  (get) => {
    const scope = get(activeCollabScopeAtom);
    return scope ? get(treeFilterByScope(scope.scopeKey)) : 'all';
  },
  (get, set, value) => {
    const scope = get(activeCollabScopeAtom);
    if (!scope) return;
    set(treeFilterByScope(scope.scopeKey), value);
    sessionsByScope.get(scope.scopeKey)?.persistViewPreferences();
  },
);
export const showUnreadBubblesAtom = atom<boolean, [boolean], void>(
  (get) => {
    const scope = get(activeCollabScopeAtom);
    return scope ? get(showUnreadByScope(scope.scopeKey)) : true;
  },
  (get, set, value) => {
    const scope = get(activeCollabScopeAtom);
    if (!scope) return;
    set(showUnreadByScope(scope.scopeKey), value);
    sessionsByScope.get(scope.scopeKey)?.persistViewPreferences();
  },
);

function currentScopeKey(get: <Value>(target: Atom<Value>) => Value): string | null {
  return get(activeCollabScopeAtom)?.scopeKey ?? null;
}

function unreadKey(scopeKey: string, documentId: string): string {
  return `${scopeKey}\u0000${documentId}`;
}

export const docUnreadAtom = atomFamily((documentId: string) => atom(
  (get) => {
    const scopeKey = currentScopeKey(get);
    return scopeKey ? get(unreadByScopeAndDocument(unreadKey(scopeKey, documentId))) : false;
  },
  (get, set, value: boolean) => {
    const scopeKey = currentScopeKey(get);
    if (scopeKey) set(unreadByScopeAndDocument(unreadKey(scopeKey, documentId)), value);
  },
));
export const docUnreadByOrgAtom = atom<Map<string, Set<string>>>(new Map());
export const docReceiptsAtom = atom<Map<string, ReadReceipt>, [Map<string, ReadReceipt> | ((current: Map<string, ReadReceipt>) => Map<string, ReadReceipt>)], void>(
  (get) => {
    const scopeKey = currentScopeKey(get);
    return scopeKey ? get(receiptsByScope(scopeKey)) : EMPTY_RECEIPTS;
  },
  (get, set, update) => {
    const scopeKey = currentScopeKey(get);
    if (!scopeKey) return;
    const target = receiptsByScope(scopeKey);
    set(target, typeof update === 'function' ? update(get(target)) : update);
  },
);

export function docSnapshot(document: SharedDocument): UnreadEntitySnapshot {
  return {
    currentVersion: null,
    currentVersionTimestamp: document.updatedAt ?? 0,
    lastChangeActorId: document.lastWriterUserId ?? null,
  };
}

function setOrgUnread(
  current: Map<string, Set<string>>,
  orgId: string,
  documentId: string,
  unread: boolean,
): Map<string, Set<string>> {
  const next = new Map(current);
  const existing = next.get(orgId);
  if (unread) {
    if (existing?.has(documentId)) return current;
    const ids = new Set(existing ?? []);
    ids.add(documentId);
    next.set(orgId, ids);
  } else {
    if (!existing?.has(documentId)) return current;
    const ids = new Set(existing);
    ids.delete(documentId);
    if (ids.size === 0) next.delete(orgId);
    else next.set(orgId, ids);
  }
  return next;
}

export const setDocUnreadAtom = atom(
  null,
  (get, set, input: { scopeKey?: string; documentId: string; orgId: string; unread: boolean }) => {
    const scopeKey = input.scopeKey ?? currentScopeKey(get);
    if (!scopeKey) return;
    let ids = unreadDocumentIdsByScope.get(scopeKey);
    if (!ids) {
      ids = new Set();
      unreadDocumentIdsByScope.set(scopeKey, ids);
    }
    ids.add(input.documentId);
    set(unreadByScopeAndDocument(unreadKey(scopeKey, input.documentId)), input.unread);
    const current = get(docUnreadByOrgAtom);
    const next = setOrgUnread(current, input.orgId, input.documentId, input.unread);
    if (next !== current) set(docUnreadByOrgAtom, next);
  },
);
export const recomputeDocUnreadAtom = atom(
  null,
  (get, set, input: {
    orgId: string;
    docs: SharedDocument[];
    receipts: Map<string, ReadReceipt>;
    currentUserId: string | null;
    scopeKey?: string;
  }) => {
    const scopeKey = input.scopeKey ?? currentScopeKey(get);
    if (!scopeKey) return;
    for (const document of input.docs) {
      const unread = isEntityUnread(
        docSnapshot(document),
        input.receipts.get(document.documentId) ?? null,
        input.currentUserId,
      );
      if (get(unreadByScopeAndDocument(unreadKey(scopeKey, document.documentId))) !== unread) {
        set(setDocUnreadAtom, { scopeKey, documentId: document.documentId, orgId: input.orgId, unread });
      }
    }
  },
);
export const applyDocReceiptAtom = atom(
  null,
  (get, set, input: { scopeKey?: string; documentId: string; orgId: string; receipt: ReadReceipt }) => {
    const scopeKey = input.scopeKey ?? currentScopeKey(get);
    if (!scopeKey) return;
    const receipts = receiptsByScope(scopeKey);
    const next = new Map(get(receipts));
    next.set(input.documentId, mergeReceipt(next.get(input.documentId), input.receipt));
    set(receipts, next);
    set(setDocUnreadAtom, { scopeKey, documentId: input.documentId, orgId: input.orgId, unread: false });
  },
);

/** Route a personal-sync document receipt by its wire-level organization scope. */
export const applyRemoteDocReceiptAtom = atom(
  null,
  (get, set, input: { documentId: string; orgId: string; receipt: ReadReceipt }) => {
    const orgSessions = [...sessionsByScope.values()]
      .filter((session) => session.scope.orgId === input.orgId);
    const matchingSessions = orgSessions
      .filter((session) => session.uiCapabilities.readReceipts);
    if (matchingSessions.length === 0) {
      if (orgSessions.length > 0) return;
      const pending = pendingRemoteReceiptsByOrg(input.orgId);
      const next = new Map(get(pending));
      next.set(input.documentId, mergeReceipt(next.get(input.documentId), input.receipt));
      set(pending, next);
      return;
    }
    for (const session of matchingSessions) {
      set(applyDocReceiptAtom, {
        ...input,
        scopeKey: session.scope.scopeKey,
      });
    }
  },
);

export const favoriteSharedDocsAtom = atom((get) =>
  selectFavoriteDocs(get(collabFavoritesAtom), get(sharedDocumentsAtom)),
);
export const recentSharedDocsAtom = atom((get) =>
  selectRecentDocs(get(sharedDocumentsAtom), get(docOpenedAtAtom)),
);
export const changedSharedDocsAtom = atom<ChangedSharedDoc[]>((get) => {
  const receipts = get(docReceiptsAtom);
  const currentUserId = get(activeTeamUserIdAtom);
  return classifyChangedDocs(get(sharedDocumentsAtom), (document) => {
    const receipt = receipts.get(document.documentId) ?? null;
    return {
      unread: isEntityUnread(docSnapshot(document), receipt, currentUserId),
      hasReceipt: receipt !== null,
    };
  });
});
export const changedDocIdsAtom = atom((get) =>
  new Set(get(changedSharedDocsAtom).map(({ doc }) => doc.documentId)),
);

export interface CollabDocsSessionAtoms {
  sharedDocuments: ListAtom<SharedDocument>;
  allSharedDocuments: ListAtom<SharedDocument>;
  trashedSharedDocuments: Atom<SharedDocument[]>;
  sharedFolders: ListAtom<SharedFolder>;
  typePlacements: ListAtom<SharedTypePlacement>;
  itemPlacements: ListAtom<SharedItemPlacement>;
  /** True when the tree is the one page tree (documents nest in documents). */
  pageTree: Atom<boolean>;
  syncStatus: WritableAtom<CollabDocsUIStatus, [CollabDocsUIStatus], void>;
  hasTeam: WritableAtom<boolean, [boolean], void>;
  activeTeamUserId: Atom<string | null>;
  favorites: Atom<string[]>;
  changedDocumentIds: Atom<Set<string>>;
  openedAt: Atom<Record<string, number>>;
  receipts: Atom<Map<string, ReadReceipt>>;
  favoriteDocuments: Atom<SharedDocument[]>;
  recentDocuments: Atom<SharedDocument[]>;
  changedDocuments: Atom<ChangedSharedDoc[]>;
  treeFilter: WritableAtom<CollabTreeFilter, [CollabTreeFilter], void>;
  showUnreadBubbles: WritableAtom<boolean, [boolean], void>;
  pendingFolder: Atom<PendingCollabFolder | null>;
  unreadDocument(documentId: string): Atom<boolean>;
}

export interface CollabDocsUICapabilities {
  personalState: boolean;
  readReceipts: boolean;
}

function createSessionAtoms(
  scope: CollabScope,
  uiCapabilities: CollabDocsUICapabilities,
): CollabDocsSessionAtoms {
  const scopeKey = scope.scopeKey;
  const allDocuments = documentsByScope(scopeKey);
  const documents = atom<SharedDocument[], [ListUpdate<SharedDocument>], void>(
    (get) => get(allDocuments).filter((document) => document.trashedAt == null),
    (get, set, update) => {
      set(allDocuments, typeof update === 'function' ? update(get(allDocuments)) : update);
    },
  );
  const trashedDocuments = atom((get) => get(allDocuments)
    .filter((document) => document.trashedAt != null)
    .sort((left, right) => (right.trashedAt ?? 0) - (left.trashedAt ?? 0)));
  const folders = visibleFoldersByScope(scopeKey);
  const syncStatus = statusByScope(scopeKey);
  const hasTeam = hasTeamByScope(scopeKey);
  const activeTeamUserId = userIdByScope(scopeKey);
  const favorites = favoritesByScope(scopeKey);
  const openedAt = openedAtByScope(scopeKey);
  const receipts = receiptsByScope(scopeKey);
  const favoriteDocuments = atom((get) => selectFavoriteDocs(get(favorites), get(documents)));
  const recentDocuments = atom((get) => selectRecentDocs(get(documents), get(openedAt)));
  const changedDocuments = atom<ChangedSharedDoc[]>((get) => (
    uiCapabilities.readReceipts
      ? classifyChangedDocs(
        get(documents),
        (document) => {
          const receipt = get(receipts).get(document.documentId) ?? null;
          return {
            unread: isEntityUnread(docSnapshot(document), receipt, get(activeTeamUserId)),
            hasReceipt: receipt !== null,
          };
        },
      )
      : []
  ));
  const changedDocumentIds = atom((get) => new Set(
    get(changedDocuments).map(({ doc }) => doc.documentId),
  ));
  const treeFilter = atom<CollabTreeFilter, [CollabTreeFilter], void>(
    (get) => get(treeFilterByScope(scopeKey)),
    (_get, set, value) => {
      const availableValue = value === 'favorites' && !uiCapabilities.personalState
        ? 'all'
        : value === 'updated' && !uiCapabilities.readReceipts
          ? 'all'
          : value;
      set(treeFilterByScope(scopeKey), availableValue);
      sessionsByScope.get(scopeKey)?.persistViewPreferences();
    },
  );
  const showUnreadBubbles = atom<boolean, [boolean], void>(
    (get) => get(showUnreadByScope(scopeKey)),
    (_get, set, value) => {
      set(showUnreadByScope(scopeKey), uiCapabilities.readReceipts && value);
      sessionsByScope.get(scopeKey)?.persistViewPreferences();
    },
  );
  const pendingFolder = atom((get) => {
    const pending = get(pendingCollabFolderAtom);
    return pending?.scopeKey === scopeKey ? pending : null;
  });
  const unreadDocuments = atomFamily((documentId: string) =>
    atom((get) => get(unreadByScopeAndDocument(unreadKey(scopeKey, documentId)))));

  return {
    sharedDocuments: documents,
    allSharedDocuments: allDocuments,
    trashedSharedDocuments: trashedDocuments,
    sharedFolders: folders,
    typePlacements: typePlacementsByScope(scopeKey),
    itemPlacements: itemPlacementsByScope(scopeKey),
    pageTree: pageTreeByScope(scopeKey),
    syncStatus,
    hasTeam,
    activeTeamUserId,
    favorites,
    changedDocumentIds,
    openedAt,
    receipts,
    favoriteDocuments,
    recentDocuments,
    changedDocuments,
    treeFilter,
    showUnreadBubbles,
    pendingFolder,
    unreadDocument: unreadDocuments,
  };
}

function hasVisibleName(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function mergeSharedDocument(existing: SharedDocument, incoming: SharedDocument): SharedDocument {
  const merged = {
    ...incoming,
    metadataVersion: incoming.metadataVersion ?? existing.metadataVersion,
    fileExtension: incoming.fileExtension ?? existing.fileExtension,
    editorId: incoming.editorId ?? existing.editorId,
  };
  return !hasVisibleName(incoming.title) && hasVisibleName(existing.title)
    ? { ...merged, title: existing.title, decryptFailed: false }
    : merged;
}

export function mergeSharedFolder(existing: SharedFolder, incoming: SharedFolder): SharedFolder {
  return !hasVisibleName(incoming.name) && hasVisibleName(existing.name)
    ? { ...incoming, name: existing.name, decryptFailed: false }
    : incoming;
}

function reconcileById<T>(
  existing: T[],
  incoming: T[],
  getId: (row: T) => string,
  merge: (previous: T, next: T) => T,
): T[] {
  const existingById = new Map(existing.map((row) => [getId(row), row]));
  const incomingIds = new Set(incoming.map(getId));
  return [
    ...incoming.map((row) => {
      const previous = existingById.get(getId(row));
      return previous ? merge(previous, row) : row;
    }),
    ...existing.filter((row) => !incomingIds.has(getId(row))),
  ];
}

export function reconcileSharedDocuments(existing: SharedDocument[], incoming: SharedDocument[]) {
  return reconcileById(existing, incoming, (document) => document.documentId, mergeSharedDocument);
}

export function reconcileSharedFolders(existing: SharedFolder[], incoming: SharedFolder[]) {
  return reconcileById(existing, incoming, (folder) => folder.folderId, mergeSharedFolder);
}

export function deriveVirtualFolderStructure(documents: SharedDocument[]) {
  const folderPaths = new Set<string>();
  const docParent = new Map<string, string>();
  for (const document of documents) {
    if (document.parentFolderId || document.decryptFailed) continue;
    const parent = getCollabParentPath(normalizeCollabPath(document.title));
    if (!parent) continue;
    docParent.set(document.documentId, parent);
    let current: string | null = parent;
    while (current) {
      folderPaths.add(current);
      current = getCollabParentPath(current);
    }
  }
  return {
    folderPaths: [...folderPaths].sort((left, right) => left.split('/').length - right.split('/').length),
    docParent,
  };
}

export function buildMigratedFolderRows(
  sortedFolderPaths: string[],
  idByPath: Map<string, string>,
  createdBy: string,
  now: number,
): SharedFolder[] {
  return sortedFolderPaths.map((path, index) => {
    const parentPath = getCollabParentPath(path);
    return {
      folderId: idByPath.get(path) as string,
      parentFolderId: parentPath ? (idByPath.get(parentPath) ?? null) : null,
      name: getCollabNodeName(path),
      sortOrder: index,
      createdBy,
      createdAt: now,
      updatedAt: now,
    };
  });
}

async function stableFolderId(orgId: string, path: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${orgId}:${path}`));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `fld_${hex.slice(0, 24)}`;
}

export interface CollabDocsSession {
  readonly scope: CollabScope;
  readonly host: DocsHost;
  readonly dataSource: CollabDocsDataSource;
  readonly atoms: CollabDocsSessionAtoms;
  readonly uiCapabilities: CollabDocsUICapabilities;
  activate(): void;
  start(): Promise<void>;
  dispose(): void;
  persistViewPreferences(): void;
  hydrateViewPreferences(state?: Partial<CollabDiscoveryState> | null): void;
  hydratePersonalState(): Promise<void>;
  /**
   * Resolves `true` when the server confirmed the index row is committed.
   * `false` means unconfirmed, not failed — see `TeamSync.registerDocument`.
   */
  registerDocument(input: {
    documentId: string;
    title: string;
    documentType: string;
    parentFolderId: string | null;
    metadata?: { metadataVersion: 2; fileExtension: string; editorId: string };
  }): Promise<boolean>;
  updateDocumentTitle(documentId: string, title: string): Promise<void>;
  removeDocument(documentId: string): void;
  trashDocument(documentId: string): void;
  restoreDocument(documentId: string): void;
  emptyTrash(): number;
  moveDocument(documentId: string, parentFolderId: string | null): void;
  createFolder(name: string, parentFolderId: string | null): Promise<string>;
  renameFolder(folderId: string, name: string): Promise<void>;
  renameLegacyFolder(path: string, name: string): Promise<number>;
  moveFolder(folderId: string, parentFolderId: string | null): void;
  removeFolder(folderId: string): void;
  refreshFolders(): Promise<boolean>;
  /** Place a tracker type in the page tree; an already placed type moves. */
  placeType(typeId: string, parentFolderId: string | null): Promise<void>;
  moveTypePlacement(typeId: string, parentFolderId: string | null, sortOrder?: number): Promise<void>;
  removeTypePlacement(typeId: string): Promise<void>;
  /** True once the snapshot said the tree is the one page tree. */
  isPageTree(): boolean;
  /** Page tree: move a page under another page (null = root). Refuses a cycle. */
  movePage(documentId: string, parentId: string | null): boolean;
  /**
   * Page tree: remove a page and every page below it, the way a folder delete
   * worked (types and items placed under them fall back, nothing else goes).
   * The prose of a type placed outside the subtree is moved out first.
   */
  removePage(documentId: string): void;
  /** How many documents besides the page itself `removePage` would remove. */
  pageRemovalCount(documentId: string): number;
  /**
   * Place a typed page (tracker item) under a page, or at root with null.
   * Resolves `{ ok: true }` only once the store confirmed the placement (the
   * server's broadcast for this item, or the local write for Personal), and
   * `{ ok: false, error }` on a refusal or timeout, after rolling back.
   */
  setItemPlacement(itemId: string, parentId: string | null, sortOrder?: number): Promise<CollabPlacementWriteResult>;
  /** Send a typed page back under its type. Same outcome contract as `setItemPlacement`. */
  removeItemPlacement(itemId: string): Promise<CollabPlacementWriteResult>;
  getItemPlacements(): SharedItemPlacement[];
  toggleFavorite(documentId: string): void;
  recordOpened(documentId: string): void;
  markDocumentViewed(documentId: string, updatedAt: number | null): Promise<void>;
  markAllDocumentsViewed(): Promise<void>;
  createDocument(input: Parameters<DocsHost['documents']['createDocument']>[0]): Promise<void>;
  clearPendingFolder(): void;
  getDocuments(): SharedDocument[];
  getFolders(): SharedFolder[];
}

class CollabDocsSessionImpl implements CollabDocsSession {
  readonly atoms: CollabDocsSessionAtoms;
  readonly uiCapabilities: CollabDocsUICapabilities;
  private dataUnsubscribe: (() => void) | null = null;
  private personalStateUnsubscribe: (() => void) | null = null;
  private receiptUnsubscribe: (() => void) | null = null;
  private startPromise: Promise<void> | null = null;
  private migratedFolders = false;
  private disposed = false;

  constructor(
    readonly scope: CollabScope,
    readonly dataSource: CollabDocsDataSource,
    readonly host: DocsHost,
  ) {
    const personalStateAvailable = host.personalState.status === 'available';
    this.uiCapabilities = Object.freeze({
      personalState: personalStateAvailable,
      // Read watermarks are personal UI only when the personal lane itself is
      // present; this keeps a partial host from exposing a misleading subset.
      readReceipts: personalStateAvailable
        && host.documents.readReceipts.status === 'available',
    });
    this.atoms = createSessionAtoms(scope, this.uiCapabilities);
  }

  activate(): void {
    store.set(activeCollabScopeAtom, this.scope);
  }

  start(): Promise<void> {
    this.startPromise ??= this.startInternal().catch((error) => {
      this.startPromise = null;
      store.set(statusByScope(this.scope.scopeKey), 'error');
      throw error;
    });
    return this.startPromise;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dataUnsubscribe?.();
    this.personalStateUnsubscribe?.();
    this.receiptUnsubscribe?.();
    this.dataSource.dispose();
    sessionsByScope.delete(this.scope.scopeKey);
    store.set(statusByScope(this.scope.scopeKey), 'disconnected');
    store.set(hasTeamByScope(this.scope.scopeKey), false);
  }

  persistViewPreferences(): void {
    const payload = {
      treeFilter: store.get(treeFilterByScope(this.scope.scopeKey)),
      showUnreadBubbles: store.get(showUnreadByScope(this.scope.scopeKey)),
    };
    void this.host.documents.saveViewPreferences(this.scope.scopeKey, payload)
      .catch((error) => this.host.reportError?.(error, 'Failed to save shared document preferences'));
  }

  hydrateViewPreferences(state?: Partial<CollabDiscoveryState> | null): void {
    const treeFilter = state?.treeFilter === 'favorites' && this.uiCapabilities.personalState
      ? 'favorites'
      : state?.treeFilter === 'updated' && this.uiCapabilities.readReceipts
        ? 'updated'
        : 'all';
    store.set(treeFilterByScope(this.scope.scopeKey), treeFilter);
    store.set(
      showUnreadByScope(this.scope.scopeKey),
      this.uiCapabilities.readReceipts && state?.showUnreadBubbles !== false,
    );
  }

  async hydratePersonalState(): Promise<void> {
    if (this.host.personalState.status === 'unavailable') return;
    const capability = this.host.personalState.capability;
    const snapshot = await capability.snapshot(this.scope);
    if (this.disposed) return;
    store.set(personalStateScopeByScope(this.scope.scopeKey), snapshot.scope);
    store.set(
      favoritesByScope(this.scope.scopeKey),
      snapshot.rows
        .filter((row) => row.isFavorite)
        .sort((left, right) => right.favoriteUpdatedAt - left.favoriteUpdatedAt)
        .map((row) => row.itemId),
    );
    store.set(
      favoriteUpdatedAtByScope(this.scope.scopeKey),
      Object.fromEntries(snapshot.rows.map((row) => [row.itemId, row.favoriteUpdatedAt])),
    );
    store.set(
      openedAtByScope(this.scope.scopeKey),
      Object.fromEntries(snapshot.rows
        .filter((row) => row.lastOpenedAt != null)
        .map((row) => [row.itemId, row.lastOpenedAt as number])),
    );
    this.personalStateUnsubscribe?.();
    this.personalStateUnsubscribe = capability.subscribe(
      this.scope,
      (row) => this.applyPersonalStateRow(row),
    );
  }

  async registerDocument(input: Parameters<CollabDocsSession['registerDocument']>[0]): Promise<boolean> {
    const now = Date.now();
    store.set(documentsByScope(this.scope.scopeKey), (current) => [{
      ...input,
      ...input.metadata,
      teamProjectId: this.scope.indexConfig.teamProjectId ?? null,
      createdBy: '',
      createdAt: now,
      updatedAt: now,
    }, ...current.filter((document) => document.documentId !== input.documentId)]);
    const result = await this.dataSource.command({ type: 'register-document', ...input });
    return result.registrationAcked === true;
  }

  async updateDocumentTitle(documentId: string, title: string): Promise<void> {
    const now = Date.now();
    store.set(documentsByScope(this.scope.scopeKey), (current) => {
      const existing = current.find((document) => document.documentId === documentId);
      return existing
        ? [{ ...existing, title, updatedAt: now }, ...current.filter((document) => document.documentId !== documentId)]
        : current;
    });
    await this.dataSource.command({ type: 'update-document-title', documentId, title })
      .catch((error) => this.reportCommandError(error, 'Failed to update document title'));
  }

  removeDocument(documentId: string): void {
    store.set(documentsByScope(this.scope.scopeKey), (current) =>
      current.filter((document) => document.documentId !== documentId));
    this.send({ type: 'remove-document', documentId });
  }

  trashDocument(documentId: string): void {
    const trashedAt = Date.now();
    store.set(documentsByScope(this.scope.scopeKey), (current) => current.map((document) =>
      document.documentId === documentId
        ? { ...document, trashedAt, updatedAt: trashedAt }
        : document));
    this.send({ type: 'trash-document', documentId, trashedAt });
  }

  restoreDocument(documentId: string): void {
    const now = Date.now();
    store.set(documentsByScope(this.scope.scopeKey), (current) => current.map((document) =>
      document.documentId === documentId
        ? { ...document, trashedAt: null, updatedAt: now }
        : document));
    this.send({ type: 'restore-document', documentId });
  }

  emptyTrash(): number {
    const trashed = this.getAllDocuments().filter((document) => document.trashedAt != null);
    for (const document of trashed) this.removeDocument(document.documentId);
    return trashed.length;
  }

  moveDocument(documentId: string, parentFolderId: string | null): void {
    store.set(documentsByScope(this.scope.scopeKey), (current) => current.map((document) =>
      document.documentId === documentId ? { ...document, parentFolderId } : document));
    this.send({ type: 'move-document', documentId, parentFolderId });
  }

  async createFolder(name: string, parentFolderId: string | null): Promise<string> {
    const folderId = crypto.randomUUID();
    if (this.isPageTree()) {
      // A folder is a page with an empty body; it gets a room on first open.
      await this.registerDocument({ documentId: folderId, title: name, documentType: 'markdown', parentFolderId })
        .catch((error) => this.reportCommandError(error, 'Failed to create page'));
      return folderId;
    }
    const now = Date.now();
    store.set(foldersByScope(this.scope.scopeKey), (current) => [...current, {
      folderId,
      parentFolderId,
      name,
      sortOrder: now,
      createdBy: '',
      createdAt: now,
      updatedAt: now,
    }]);
    await this.dataSource.command({
      type: 'register-folder',
      folderId,
      name,
      parentFolderId,
      sortOrder: now,
    }).catch((error) => this.reportCommandError(error, 'Failed to create shared folder'));
    return folderId;
  }

  async renameFolder(folderId: string, name: string): Promise<void> {
    if (this.isPageTree()) return this.updateDocumentTitle(folderId, name);
    store.set(foldersByScope(this.scope.scopeKey), (current) => current.map((folder) =>
      folder.folderId === folderId ? { ...folder, name, updatedAt: Date.now() } : folder));
    await this.dataSource.command({ type: 'rename-folder', folderId, name })
      .catch((error) => this.reportCommandError(error, 'Failed to rename shared folder'));
  }

  async renameLegacyFolder(path: string, name: string): Promise<number> {
    const updates = computeLegacyFolderRenameUpdates(this.getAllDocuments(), path, name);
    for (const update of updates) await this.updateDocumentTitle(update.documentId, update.newTitle);
    return updates.length;
  }

  moveFolder(folderId: string, parentFolderId: string | null): void {
    if (this.isPageTree()) {
      this.movePage(folderId, parentFolderId);
      return;
    }
    const folders = this.getFolders();
    if (parentFolderId && isDescendantFolder(folders, parentFolderId, folderId)) return;
    store.set(foldersByScope(this.scope.scopeKey), (current) => current.map((folder) =>
      folder.folderId === folderId ? { ...folder, parentFolderId, updatedAt: Date.now() } : folder));
    this.send({ type: 'move-folder', folderId, parentFolderId });
  }

  removeFolder(folderId: string): void {
    if (this.isPageTree()) {
      this.removePage(folderId);
      return;
    }
    const removed = new Set(collectFolderSubtree(this.getFolders(), folderId));
    store.set(foldersByScope(this.scope.scopeKey), (current) =>
      current.filter((folder) => !removed.has(folder.folderId)));
    store.set(documentsByScope(this.scope.scopeKey), (current) => current.filter((document) =>
      !(document.parentFolderId && removed.has(document.parentFolderId))));
    // The server removes placements inside the subtree too.
    store.set(typePlacementsByScope(this.scope.scopeKey), (current) => current.filter((placement) =>
      !(placement.parentFolderId && removed.has(placement.parentFolderId))));
    this.send({ type: 'remove-folder', folderId });
  }

  async refreshFolders(): Promise<boolean> {
    if (this.dataSource.status() === 'disconnected' || this.dataSource.status() === 'error') {
      await this.dataSource.command({ type: 'reconnect' });
    }
    return (await this.dataSource.command({ type: 'refresh-folders' })).folders !== null;
  }

  placeType(typeId: string, parentFolderId: string | null): Promise<void> {
    return this.writeTypePlacement(typeId, parentFolderId, Date.now());
  }

  moveTypePlacement(typeId: string, parentFolderId: string | null, sortOrder?: number): Promise<void> {
    const existing = store.get(typePlacementsByScope(this.scope.scopeKey))
      .find((placement) => placement.typeId === typeId);
    return this.writeTypePlacement(typeId, parentFolderId, sortOrder ?? existing?.sortOrder ?? Date.now());
  }

  async removeTypePlacement(typeId: string): Promise<void> {
    store.set(typePlacementsByScope(this.scope.scopeKey), (current) =>
      current.filter((placement) => placement.typeId !== typeId));
    await this.dataSource.command({ type: 'remove-type-placement', typeId })
      .catch((error) => this.reportCommandError(error, 'Failed to remove tracker type from the tree'));
  }

  isPageTree(): boolean {
    return store.get(pageTreeByScope(this.scope.scopeKey));
  }

  movePage(documentId: string, parentId: string | null): boolean {
    if (parentId && isDescendantFolder(projectPagesAsFolders(this.getAllDocuments()), parentId, documentId)) {
      return false;
    }
    this.moveDocument(documentId, parentId);
    return true;
  }

  pageRemovalCount(documentId: string): number {
    return planPageRemoval(this.getAllDocuments(), store.get(typePlacementsByScope(this.scope.scopeKey)), documentId)
      .childCount;
  }

  removePage(documentId: string): void {
    const scopeKey = this.scope.scopeKey;
    const plan = planPageRemoval(this.getAllDocuments(), store.get(typePlacementsByScope(scopeKey)), documentId);
    // Sent before the removal on the same ordered channel, so the store has
    // moved the prose out of the subtree by the time it removes it.
    for (const { documentId: proseId, parentId } of plan.relocate) this.moveDocument(proseId, parentId);
    const removed = new Set(plan.removedIds);
    store.set(documentsByScope(scopeKey), (current) =>
      current.filter((document) => !removed.has(document.documentId)));
    store.set(typePlacementsByScope(scopeKey), (current) => current.filter((placement) =>
      !(placement.parentFolderId && removed.has(placement.parentFolderId))));
    store.set(itemPlacementsByScope(scopeKey), (current) => current.filter((placement) =>
      !(placement.parentId && removed.has(placement.parentId))));
    // The store maps a folder removal onto the page and its subtree.
    this.send({ type: 'remove-folder', folderId: documentId });
  }

  setItemPlacement(itemId: string, parentId: string | null, sortOrder?: number): Promise<CollabPlacementWriteResult> {
    const now = Date.now();
    const existing = this.getItemPlacements().find((placement) => placement.itemId === itemId);
    const order = sortOrder ?? existing?.sortOrder ?? now;
    const optimistic: SharedItemPlacement = {
      itemId,
      projectId: existing?.projectId ?? this.scope.indexConfig.teamProjectId ?? null,
      parentId,
      sortOrder: order,
      createdBy: existing?.createdBy ?? '',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    return this.writeItemPlacement(itemId, optimistic, { type: 'set-item-placement', itemId, parentId, sortOrder: order });
  }

  removeItemPlacement(itemId: string): Promise<CollabPlacementWriteResult> {
    return this.writeItemPlacement(itemId, null, { type: 'remove-item-placement', itemId });
  }

  /**
   * Optimistic write, settled by the data source: it resolves once the store
   * confirmed the change and rejects on a refusal or timeout. On a rejection
   * the previous row comes back, unless a later write already replaced ours.
   */
  private async writeItemPlacement(
    itemId: string,
    optimistic: SharedItemPlacement | null,
    command: Extract<CollabDocsCommand, { type: 'set-item-placement' | 'remove-item-placement' }>,
  ): Promise<CollabPlacementWriteResult> {
    const target = itemPlacementsByScope(this.scope.scopeKey);
    const previous = store.get(target).find((placement) => placement.itemId === itemId) ?? null;
    const withRow = (row: SharedItemPlacement | null) => (current: SharedItemPlacement[]) => [
      ...current.filter((placement) => placement.itemId !== itemId),
      ...(row ? [row] : []),
    ];
    store.set(target, withRow(optimistic));
    try {
      await this.dataSource.command(command);
      return { ok: true };
    } catch (error) {
      const current = store.get(target).find((placement) => placement.itemId === itemId) ?? null;
      if (current === optimistic) store.set(target, withRow(previous));
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  getItemPlacements(): SharedItemPlacement[] {
    return store.get(itemPlacementsByScope(this.scope.scopeKey));
  }

  /** Optimistic upsert; the server echoes the stored row back to its author. */
  private async writeTypePlacement(typeId: string, parentFolderId: string | null, sortOrder: number): Promise<void> {
    const now = Date.now();
    // The type page's prose belongs to the type: it moves with the placement,
    // so removing the page the type used to sit under cannot take it along.
    const prose = this.getAllDocuments().find((document) => document.documentId === `${TYPE_PAGE_DOCUMENT_PREFIX}${typeId}`);
    if (prose && (prose.parentFolderId ?? null) !== parentFolderId) this.moveDocument(prose.documentId, parentFolderId);
    store.set(typePlacementsByScope(this.scope.scopeKey), (current) => {
      const existing = current.find((placement) => placement.typeId === typeId);
      return [...current.filter((placement) => placement.typeId !== typeId), {
        typeId,
        projectId: existing?.projectId ?? this.scope.indexConfig.teamProjectId ?? null,
        parentFolderId,
        sortOrder,
        createdBy: existing?.createdBy ?? '',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }];
    });
    await this.dataSource.command({ type: 'set-type-placement', typeId, parentFolderId, sortOrder })
      .catch((error) => this.reportCommandError(error, 'Failed to place tracker type'));
  }

  toggleFavorite(documentId: string): void {
    if (this.host.personalState.status === 'unavailable') return;
    const capability = this.host.personalState.capability;
    const target = favoritesByScope(this.scope.scopeKey);
    const versionTarget = favoriteUpdatedAtByScope(this.scope.scopeKey);
    const previous = store.get(target);
    const previousVersion = store.get(versionTarget)[documentId] ?? 0;
    const next = previous.includes(documentId)
      ? previous.filter((id) => id !== documentId)
      : [documentId, ...previous];
    const favoriteUpdatedAt = Date.now();
    store.set(target, next);
    store.set(versionTarget, { ...store.get(versionTarget), [documentId]: favoriteUpdatedAt });
    void capability.setFavorite({
      scope: this.scope,
      itemId: documentId,
      isFavorite: next.includes(documentId),
      favoriteUpdatedAt,
    }).then((row) => {
      if (row) this.applyPersonalStateRow(row);
    }).catch((error) => {
      if (store.get(versionTarget)[documentId] === favoriteUpdatedAt) {
        store.set(target, previous);
        store.set(versionTarget, { ...store.get(versionTarget), [documentId]: previousVersion });
      }
      this.host.reportError?.(error, 'Failed to save document favorite');
    });
  }

  recordOpened(documentId: string): void {
    if (this.host.personalState.status === 'unavailable') return;
    const capability = this.host.personalState.capability;
    const target = openedAtByScope(this.scope.scopeKey);
    const previous = store.get(target)[documentId] ?? null;
    const lastOpenedAt = Date.now();
    store.set(target, { ...store.get(target), [documentId]: lastOpenedAt });
    void capability.recordOpened({
      scope: this.scope,
      itemId: documentId,
      lastOpenedAt,
    }).then((row) => {
      if (row) this.applyPersonalStateRow(row);
    }).catch((error) => {
      const current = store.get(target);
      if (current[documentId] !== lastOpenedAt) return;
      const next = { ...current };
      if (previous === null) delete next[documentId];
      else next[documentId] = previous;
      store.set(target, next);
      this.host.reportError?.(error, 'Failed to record document open');
    });
  }

  async markDocumentViewed(documentId: string, updatedAt: number | null): Promise<void> {
    if (this.host.documents.readReceipts.status === 'unavailable') return;
    const lastViewedAt = Math.max(Date.now(), updatedAt ?? 0);
    await this.host.documents.readReceipts.capability.markViewed({
      scope: this.scope,
      documentId,
      lastViewedAt,
    });
    store.set(applyDocReceiptAtom, {
      documentId,
      orgId: this.scope.orgId,
      scopeKey: this.scope.scopeKey,
      receipt: { lastSeenVersion: null, lastViewedAt },
    });
  }

  async markAllDocumentsViewed(): Promise<void> {
    if (this.host.documents.readReceipts.status === 'unavailable') return;
    const changed = classifyChangedDocs(this.getDocuments(), (document) => {
      const receipt = store.get(receiptsByScope(this.scope.scopeKey)).get(document.documentId) ?? null;
      return {
        unread: isEntityUnread(
          docSnapshot(document),
          receipt,
          this.scope.indexConfig.teamMemberId ?? null,
        ),
        hasReceipt: receipt !== null,
      };
    });
    await Promise.all(changed.map(({ doc }) =>
      this.markDocumentViewed(doc.documentId, doc.updatedAt ?? null)));
  }

  createDocument(input: Parameters<DocsHost['documents']['createDocument']>[0]): Promise<void> {
    return this.host.documents.createDocument(input);
  }

  clearPendingFolder(): void {
    store.set(pendingCollabFolderAtom, null);
  }

  getDocuments(): SharedDocument[] {
    return this.getAllDocuments().filter((document) => document.trashedAt == null);
  }

  getFolders(): SharedFolder[] {
    return store.get(visibleFoldersByScope(this.scope.scopeKey));
  }

  private getAllDocuments(): SharedDocument[] {
    return store.get(documentsByScope(this.scope.scopeKey));
  }

  private async startInternal(): Promise<void> {
    if (this.disposed) throw new Error('Collab docs session has been disposed');
    // A Personal scope is not a team: `workspaceHasTeamAtom` must keep meaning
    // "this project has a team" even when only Personal pages are running.
    if (!isPersonalCollabScope(this.scope)) store.set(hasTeamByScope(this.scope.scopeKey), true);
    store.set(orgIdByScope(this.scope.scopeKey), this.scope.orgId);
    store.set(userIdByScope(this.scope.scopeKey), this.scope.indexConfig.teamMemberId ?? null);
    this.dataUnsubscribe = this.dataSource.subscribe((change) => this.applyDataChange(change));
    const receiptCapability = this.host.documents.readReceipts.status === 'available'
      ? this.host.documents.readReceipts.capability
      : null;
    const [snapshot, preferences, , receipts] = await Promise.all([
      this.dataSource.snapshot(),
      this.host.documents.loadViewPreferences(this.scope.scopeKey),
      this.hydratePersonalState(),
      receiptCapability?.snapshot(this.scope) ?? Promise.resolve([]),
    ]);
    if (this.disposed) return;
    this.applyDataChange({ type: 'snapshot', snapshot });
    this.hydrateViewPreferences(preferences);
    this.applyReceiptSnapshot(receipts);
    this.receiptUnsubscribe = receiptCapability?.subscribe?.(
      this.scope,
      (row) => this.applyReceiptRow(row),
    ) ?? null;
  }

  private applyDataChange(change: CollabDocsDataChange): void {
    const scopeKey = this.scope.scopeKey;
    switch (change.type) {
      case 'snapshot':
        store.set(documentsByScope(scopeKey), (current) =>
          reconcileSharedDocuments(current, change.snapshot.items));
        store.set(foldersByScope(scopeKey), (current) =>
          reconcileSharedFolders(current, change.snapshot.containers));
        // Authoritative when present, unlike the reconciled lists above: a
        // placement is ids only, so there is no locked name to preserve.
        if (change.snapshot.typePlacements) {
          store.set(typePlacementsByScope(scopeKey), change.snapshot.typePlacements);
        }
        if (change.snapshot.itemPlacements) {
          store.set(itemPlacementsByScope(scopeKey), change.snapshot.itemPlacements);
        }
        // Only ever turns on: a snapshot from a host that omits the flag must
        // not drop a converted tree back to folders.
        if (change.snapshot.pageTree) store.set(pageTreeByScope(scopeKey), true);
        // Path-in-title folders become folder rows; a page tree has none.
        if (!this.isPageTree()) void this.migrateVirtualFolders();
        break;
      case 'items-upserted':
        store.set(documentsByScope(scopeKey), (current) => {
          let next = current;
          for (const incoming of change.items) {
            const existing = next.find((document) => document.documentId === incoming.documentId);
            const merged = existing ? mergeSharedDocument(existing, incoming) : incoming;
            next = [merged, ...next.filter((document) => document.documentId !== incoming.documentId)];
          }
          return next;
        });
        break;
      case 'items-removed': {
        const removed = new Set(change.itemIds);
        store.set(documentsByScope(scopeKey), (current) =>
          current.filter((document) => !removed.has(document.documentId)));
        break;
      }
      case 'containers-upserted':
        store.set(foldersByScope(scopeKey), (current) => {
          let next = current;
          for (const incoming of change.containers) {
            const existing = next.find((folder) => folder.folderId === incoming.folderId);
            const merged = existing ? mergeSharedFolder(existing, incoming) : incoming;
            next = [...next.filter((folder) => folder.folderId !== incoming.folderId), merged];
          }
          return next;
        });
        break;
      case 'containers-removed': {
        const removedFolders = new Set(change.containerIds);
        const removedDocuments = new Set(change.itemIds);
        store.set(foldersByScope(scopeKey), (current) =>
          current.filter((folder) => !removedFolders.has(folder.folderId)));
        store.set(documentsByScope(scopeKey), (current) =>
          current.filter((document) => !removedDocuments.has(document.documentId)));
        break;
      }
      case 'status':
        store.set(statusByScope(scopeKey), change.status);
    }
    this.recomputeUnread();
  }

  private applyPersonalStateRow(row: CollabPersonalStateRow): void {
    if (store.get(personalStateScopeByScope(this.scope.scopeKey)) !== row.scope) return;
    const favorites = favoritesByScope(this.scope.scopeKey);
    const favoriteVersions = favoriteUpdatedAtByScope(this.scope.scopeKey);
    const currentFavoriteVersions = store.get(favoriteVersions);
    if (row.favoriteUpdatedAt >= (currentFavoriteVersions[row.itemId] ?? 0)) {
      const currentFavorites = store.get(favorites);
      store.set(favorites, row.isFavorite
        ? [row.itemId, ...currentFavorites.filter((id) => id !== row.itemId)]
        : currentFavorites.filter((id) => id !== row.itemId));
      store.set(favoriteVersions, {
        ...currentFavoriteVersions,
        [row.itemId]: row.favoriteUpdatedAt,
      });
    }
    if (row.lastOpenedAt != null) {
      const openedAt = openedAtByScope(this.scope.scopeKey);
      const current = store.get(openedAt);
      if (row.lastOpenedAt >= (current[row.itemId] ?? 0)) {
        store.set(openedAt, { ...current, [row.itemId]: row.lastOpenedAt });
      }
    }
  }

  private applyReceiptSnapshot(rows: Array<{ entityId: string } & ReadReceipt>): void {
    const target = receiptsByScope(this.scope.scopeKey);
    const receipts = new Map(store.get(target));
    for (const row of rows) {
      receipts.set(row.entityId, mergeReceipt(receipts.get(row.entityId), row));
    }
    store.set(target, receipts);
    this.recomputeUnread();
  }

  private applyReceiptRow(row: { entityId: string } & ReadReceipt): void {
    const target = receiptsByScope(this.scope.scopeKey);
    const receipts = new Map(store.get(target));
    receipts.set(row.entityId, mergeReceipt(receipts.get(row.entityId), row));
    store.set(target, receipts);
    this.recomputeUnread();
  }

  private recomputeUnread(): void {
    if (!this.uiCapabilities.readReceipts) return;
    store.set(recomputeDocUnreadAtom, {
      orgId: this.scope.orgId,
      scopeKey: this.scope.scopeKey,
      docs: this.getDocuments(),
      receipts: store.get(receiptsByScope(this.scope.scopeKey)),
      currentUserId: this.scope.indexConfig.teamMemberId ?? null,
    });
  }

  private send(command: Parameters<CollabDocsDataSource['command']>[0]): void {
    void this.dataSource.command(command)
      .catch((error) => this.reportCommandError(error, `Failed to ${command.type}`));
  }

  private reportCommandError(error: unknown, context: string): void {
    this.host.reportError?.(error, context);
  }

  private async migrateVirtualFolders(): Promise<void> {
    if (this.migratedFolders) return;
    const { folderPaths, docParent } = deriveVirtualFolderStructure(this.getAllDocuments());
    if (folderPaths.length === 0) return;
    this.migratedFolders = true;
    const idByPath = new Map<string, string>();
    for (const path of folderPaths) idByPath.set(path, await stableFolderId(this.scope.orgId, path));
    const rows = buildMigratedFolderRows(
      folderPaths,
      idByPath,
      this.scope.indexConfig.teamMemberId ?? '',
      Date.now(),
    );
    store.set(foldersByScope(this.scope.scopeKey), (current) => {
      const byId = new Map(current.map((folder) => [folder.folderId, folder]));
      for (const folder of rows) byId.set(folder.folderId, folder);
      return [...byId.values()];
    });
    for (const folder of rows) {
      await this.dataSource.command({
        type: 'register-folder',
        folderId: folder.folderId,
        name: folder.name,
        parentFolderId: folder.parentFolderId ?? null,
        sortOrder: folder.sortOrder,
      }).catch((error) => this.reportCommandError(error, 'Failed to migrate shared folder'));
    }
    store.set(documentsByScope(this.scope.scopeKey), (current) => current.map((document) => {
      const parentPath = docParent.get(document.documentId);
      const parentFolderId = parentPath ? idByPath.get(parentPath) : null;
      return parentFolderId ? { ...document, parentFolderId } : document;
    }));
    for (const [documentId, parentPath] of docParent) {
      const parentFolderId = idByPath.get(parentPath);
      if (parentFolderId) this.send({ type: 'move-document', documentId, parentFolderId });
    }
  }
}

export function createCollabDocsSession(
  scope: CollabScope,
  dataSource: CollabDocsDataSource,
  host: DocsHost,
): CollabDocsSession {
  const existing = sessionsByScope.get(scope.scopeKey);
  if (existing) return existing;
  const session = new CollabDocsSessionImpl(scope, dataSource, host);
  sessionsByScope.set(scope.scopeKey, session);
  return session;
}

export interface CollabDocsScopeLifecycleOptions {
  onSessionChanged(session: CollabDocsSession | null): void;
  onError?(error: unknown): void;
  retryDelaysMs?: readonly number[];
}

export interface CollabDocsScopeLifecycle {
  start(): void;
  dispose(): void;
}

const DEFAULT_SCOPE_RETRY_DELAYS_MS = [3000, 6000, 12000, 24000, 30000] as const;

/** Resolve, activate, retry, replace, and tear down the session behind one host. */
export function createCollabDocsScopeLifecycle(
  host: DocsHost,
  options: CollabDocsScopeLifecycleOptions,
): CollabDocsScopeLifecycle {
  const retryDelays = options.retryDelaysMs ?? DEFAULT_SCOPE_RETRY_DELAYS_MS;
  let currentSession: CollabDocsSession | null = null;
  let scopeUnsubscribe: (() => void) | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  let started = false;
  let disposed = false;

  const cancelRetry = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };

  const clearSession = () => {
    const previous = currentSession;
    currentSession = null;
    if (previous && store.get(activeCollabScopeAtom)?.scopeKey === previous.scope.scopeKey) {
      store.set(activeCollabScopeAtom, null);
    }
    previous?.dispose();
    options.onSessionChanged(null);
  };

  const activateScope = (scope: CollabScope) => {
    cancelRetry();
    if (currentSession?.scope !== scope) {
      if (currentSession) clearSession();
      currentSession = createCollabDocsSession(scope, host.documents.dataSource, host);
    }
    currentSession.activate();
    options.onSessionChanged(currentSession);
    void currentSession.start().catch((error) => options.onError?.(error));
  };

  const resolve = async (attempt: number, expectedGeneration: number): Promise<void> => {
    try {
      const scope = await host.resolveScope();
      if (disposed || expectedGeneration !== generation) return;
      activateScope(scope);
    } catch (error) {
      if (disposed || expectedGeneration !== generation) return;
      const retryable = !(error instanceof CollabScopeResolutionError) || error.retryable;
      const delay = retryDelays[attempt];
      if (retryable && delay !== undefined) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void resolve(attempt + 1, expectedGeneration);
        }, delay);
      } else {
        options.onError?.(error);
      }
    }
  };

  return {
    start() {
      if (started || disposed) return;
      started = true;
      scopeUnsubscribe = host.onScopeChanged((scope) => {
        if (disposed) return;
        generation += 1;
        cancelRetry();
        if (scope) {
          activateScope(scope);
        } else {
          clearSession();
          void resolve(0, generation);
        }
      });
      void resolve(0, generation);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      cancelRetry();
      scopeUnsubscribe?.();
      scopeUnsubscribe = null;
      clearSession();
    },
  };
}

export function getCollabDocsSession(scopeKey: string): CollabDocsSession | null {
  return sessionsByScope.get(scopeKey) ?? null;
}

export function getSharedDocumentsForScopeKey(scopeKey: string): SharedDocument[] {
  return store.get(documentsByScope(scopeKey)).filter((document) => document.trashedAt == null);
}

export function getSharedFoldersForScopeKey(scopeKey: string): SharedFolder[] {
  return store.get(visibleFoldersByScope(scopeKey));
}

export function getFavoriteDocumentIdsForScopeKey(scopeKey: string): string[] {
  return store.get(favoritesByScope(scopeKey));
}

export function setCollabScopeAvailability(scopeKey: string, available: boolean): void {
  store.set(hasTeamByScope(scopeKey), available);
}

export function pruneCollabDocsSession(scopeKey: string): void {
  const session = sessionsByScope.get(scopeKey);
  session?.dispose();
  if (store.get(activeCollabScopeAtom)?.scopeKey === scopeKey) {
    store.set(activeCollabScopeAtom, null);
  }
  const unreadDocumentIds = unreadDocumentIdsByScope.get(scopeKey) ?? new Set<string>();
  unreadDocumentIdsByScope.delete(scopeKey);
  for (const documentId of unreadDocumentIds) {
    unreadByScopeAndDocument.remove(unreadKey(scopeKey, documentId));
    const retainedElsewhere = [...unreadDocumentIdsByScope.values()]
      .some((documentIds) => documentIds.has(documentId));
    if (!retainedElsewhere) docUnreadAtom.remove(documentId);
  }
  documentsByScope.remove(scopeKey);
  foldersByScope.remove(scopeKey);
  visibleFoldersByScope.remove(scopeKey);
  typePlacementsByScope.remove(scopeKey);
  itemPlacementsByScope.remove(scopeKey);
  pageTreeByScope.remove(scopeKey);
  statusByScope.remove(scopeKey);
  hasTeamByScope.remove(scopeKey);
  orgIdByScope.remove(scopeKey);
  userIdByScope.remove(scopeKey);
  favoritesByScope.remove(scopeKey);
  favoriteUpdatedAtByScope.remove(scopeKey);
  openedAtByScope.remove(scopeKey);
  treeFilterByScope.remove(scopeKey);
  showUnreadByScope.remove(scopeKey);
  personalStateScopeByScope.remove(scopeKey);
  receiptsByScope.remove(scopeKey);
}
