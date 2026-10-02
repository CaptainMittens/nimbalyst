// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import type { TeamSyncConfig } from '@nimbalyst/runtime/sync';
import type { CollabScope } from '@nimbalyst/collab-client/core';
import { asTeamJwt, asTeamMemberId } from '@nimbalyst/runtime/auth/jwtScopes';
import { ElectronCollabDocumentsDataSource } from '../ElectronCollabDocumentsDataSource';

const scope: CollabScope = {
  scopeKey: 'scope-one',
  orgId: 'org-one',
  indexConfig: {
    serverUrl: 'wss://example.test',
    teamProjectId: 'project-one',
    teamMemberId: asTeamMemberId('member-one'),
  },
};

describe('ElectronCollabDocumentsDataSource', () => {
  it('projects provider snapshots/events and routes commands through the provider', async () => {
    let config!: TeamSyncConfig;
    const observeStatus = vi.fn();
    const onDocumentFeedbackIndex = vi.fn();
    const provider = {
      connect: vi.fn(async () => undefined),
      getStatus: vi.fn(() => 'connected' as const),
      getDocuments: vi.fn(() => [{
        documentId: 'doc-1',
        projectId: 'project-owned',
        title: 'One',
        documentType: 'markdown',
        createdBy: 'member-one',
        createdAt: 1,
        updatedAt: 2,
      }]),
      getFolders: vi.fn(() => [{
        folderId: 'folder-1',
        parentFolderId: null,
        name: 'Folder',
        sortOrder: 1,
        createdBy: 'member-one',
        createdAt: 1,
        updatedAt: 2,
      }]),
      getTypePlacements: vi.fn(() => [{
        typeId: 'module',
        projectId: 'project-one',
        parentFolderId: 'folder-1',
        sortOrder: 1,
        createdBy: 'member-one',
        createdAt: 1,
        updatedAt: 2,
      }]),
      getItemPlacements: vi.fn(() => [{
        itemId: 'item-1',
        projectId: 'project-one',
        parentId: 'doc-1',
        sortOrder: 2,
        createdBy: 'member-one',
        createdAt: 1,
        updatedAt: 2,
      }]),
      isPageTree: vi.fn(() => true),
      setItemPlacement: vi.fn(),
      removeItemPlacement: vi.fn(),
      refreshItemPlacements: vi.fn(async () => null),
      getTeamState: vi.fn(() => ({ members: [] })),
      updateDocumentTitle: vi.fn(async () => undefined),
      refreshFolders: vi.fn(async () => []),
      setTypePlacement: vi.fn(),
      removeTypePlacement: vi.fn(),
      refreshTypePlacements: vi.fn(async () => null),
      destroy: vi.fn(),
    };
    const source = new ElectronCollabDocumentsDataSource({
      scope,
      getJwt: async () => asTeamJwt('team-jwt'),
      events: { observeStatus, onDocumentFeedbackIndex },
      createProvider: (nextConfig) => {
        config = nextConfig;
        return provider as any;
      },
    });
    const changes: string[] = [];
    source.subscribe((change) => changes.push(change.type));

    await expect(source.snapshot()).resolves.toEqual({
      items: [expect.objectContaining({
        documentId: 'doc-1',
        title: 'One',
        teamProjectId: 'project-owned',
      })],
      containers: [expect.objectContaining({ folderId: 'folder-1', name: 'Folder' })],
      typePlacements: [expect.objectContaining({ typeId: 'module', parentFolderId: 'folder-1' })],
      itemPlacements: [expect.objectContaining({ itemId: 'item-1', parentId: 'doc-1', sortOrder: 2 })],
      pageTree: true,
    });
    config.onDocumentChanged?.({
      documentId: 'doc-2',
      projectId: 'project-two',
      title: 'Two',
      documentType: 'markdown',
      createdBy: 'member-two',
      createdAt: 3,
      updatedAt: 4,
    });
    config.onFoldersRemoved?.(['folder-1'], ['doc-1']);
    // Placement changes reach the session as snapshots carrying typePlacements.
    config.onTypePlacementsRemoved?.(['module']);
    config.onStatusChange?.('connected');
    const inventory = { epoch: 'socket', sequence: 1, generation: 1, status: 'ready' as const, entries: [] };
    config.onDocumentFeedbackIndex?.(inventory);
    expect(onDocumentFeedbackIndex).toHaveBeenCalledWith(inventory);
    await source.command({ type: 'update-document-title', documentId: 'doc-1', title: 'Renamed' });
    await source.command({ type: 'set-type-placement', typeId: 'module', parentFolderId: null, sortOrder: 4 });
    await source.command({ type: 'remove-type-placement', typeId: 'module' });
    await expect(source.command({ type: 'refresh-type-placements' }))
      .resolves.toEqual({ ok: true, typePlacements: null });
    await expect(source.command({ type: 'refresh-item-placements' }))
      .resolves.toEqual({ ok: true, itemPlacements: null });

    expect(changes).toEqual(['items-upserted', 'containers-removed', 'snapshot', 'status']);
    expect(provider.setTypePlacement).toHaveBeenCalledWith('module', null, 4);
    expect(provider.removeTypePlacement).toHaveBeenCalledWith('module');
    // No server list yet (older server): the snapshot must not claim an empty one.
    provider.getTypePlacements.mockReturnValueOnce(null as never);
    provider.getItemPlacements.mockReturnValueOnce(null as never);
    provider.isPageTree.mockReturnValueOnce(false);
    const olderServer = await source.snapshot();
    expect(olderServer).not.toHaveProperty('typePlacements');
    expect(olderServer).not.toHaveProperty('itemPlacements');
    expect(olderServer).not.toHaveProperty('pageTree');
    expect(observeStatus).toHaveBeenCalledWith('connected');
    expect(provider.updateDocumentTitle).toHaveBeenCalledWith('doc-1', 'Renamed');
    expect(provider.connect).toHaveBeenCalledTimes(1);
    source.dispose();
    expect(provider.destroy).toHaveBeenCalledTimes(1);
  });

  it('settles an item placement write on the server\'s broadcast, a refusal, or a timeout', async () => {
    vi.useFakeTimers();
    try {
      let config!: TeamSyncConfig;
      const placement = (itemId: string, parentId: string | null) => ({
        itemId, projectId: 'project-one', parentId, sortOrder: 0, createdBy: 'm', createdAt: 1, updatedAt: 1,
      });
      const provider = {
        connect: vi.fn(async () => undefined),
        getStatus: vi.fn(() => 'connected' as const),
        getDocuments: vi.fn(() => []),
        getFolders: vi.fn(() => []),
        getTypePlacements: vi.fn(() => null),
        getItemPlacements: vi.fn(() => null),
        isPageTree: vi.fn(() => true),
        setItemPlacement: vi.fn(),
        removeItemPlacement: vi.fn(),
        destroy: vi.fn(),
      };
      const source = new ElectronCollabDocumentsDataSource({
        scope,
        getJwt: async () => asTeamJwt('team-jwt'),
        createProvider: (nextConfig) => {
          config = nextConfig;
          return provider as any;
        },
      });
      const settled = (promise: Promise<unknown>) => promise.then(() => 'ok', (error: Error) => error.message);

      // Confirmed by the broadcast for this item, not by an unrelated one.
      const set = settled(source.command({ type: 'set-item-placement', itemId: 'i1', parentId: 'page-1', sortOrder: 0 }));
      await vi.advanceTimersByTimeAsync(0);
      expect(provider.setItemPlacement).toHaveBeenCalledWith('i1', 'page-1', 0);
      config.onItemPlacementChanged?.(placement('other', 'page-1') as never);
      config.onItemPlacementChanged?.(placement('i1', 'page-1') as never);
      expect(await set).toBe('ok');

      const remove = settled(source.command({ type: 'remove-item-placement', itemId: 'i1' }));
      await vi.advanceTimersByTimeAsync(0);
      config.onItemPlacementsRemoved?.(['i1']);
      expect(await remove).toBe('ok');

      // A refusal: TeamSync re-reads the list after a server error, and the
      // list does not hold the change.
      const refused = settled(source.command({ type: 'set-item-placement', itemId: 'i2', parentId: 'page-2', sortOrder: 0 }));
      await vi.advanceTimersByTimeAsync(0);
      config.onItemPlacementsLoaded?.([placement('i2', null)] as never);
      expect(await refused).toMatch(/refused/);

      // No answer within 6 seconds.
      const silent = settled(source.command({ type: 'remove-item-placement', itemId: 'i3' }));
      await vi.advanceTimersByTimeAsync(6000);
      expect(await silent).toMatch(/did not confirm/);
      source.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  // The team socket must not be opened with the browser WebSocket: Chromium
  // stamps an Origin header the sync server rejects for non-allowlisted origins
  // (the dev renderer is http://localhost:5273), which surfaces only as an
  // opaque 1006 close and leaves Shared Docs stuck on "Disconnected".
  it('opens the team socket through the main-process proxy when it is available', () => {
    const wsConnect = vi.fn(async () => ({ success: true, wsId: 'ws-1' }));
    const onWsEvent = vi.fn(() => () => {});
    vi.stubGlobal('window', { electronAPI: { documentSync: { wsConnect, onWsEvent } } });
    try {
      let config!: TeamSyncConfig;
      new ElectronCollabDocumentsDataSource({
        scope,
        getJwt: async () => asTeamJwt('team-jwt'),
        createProvider: (nextConfig) => {
          config = nextConfig;
          return { getStatus: () => 'disconnected' } as any;
        },
      });
      // Not just "some function": driving it must reach the main-process IPC
      // rather than constructing a browser WebSocket, whose Origin header the
      // sync server rejects with a 403 the renderer only sees as a 1006.
      config.createWebSocket!('wss://sync.nimbalyst.test/sync/room');
      expect(wsConnect).toHaveBeenCalledWith('wss://sync.nimbalyst.test/sync/room');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back to the platform WebSocket when no proxy IPC is exposed', () => {
    let config!: TeamSyncConfig;
    new ElectronCollabDocumentsDataSource({
      scope,
      getJwt: async () => asTeamJwt('team-jwt'),
      createProvider: (nextConfig) => {
        config = nextConfig;
        return { getStatus: () => 'disconnected' } as any;
      },
    });
    expect(config.createWebSocket).toBeUndefined();
  });
});
