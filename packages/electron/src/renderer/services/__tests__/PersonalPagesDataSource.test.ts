// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPersonalCollabScope } from '@nimbalyst/collab-client/core';
import {
  createCollabDocsSession,
  pruneCollabDocsSession,
  type CollabDocsDataChange,
} from '@nimbalyst/collab-client/docs';
import { store } from '@nimbalyst/runtime/store';
import { personalPagesRevisionAtomFamily } from '../../store/listeners/personalPagesListeners';
import { PersonalPagesDataSource } from '../PersonalPagesDataSource';

const WORKSPACE = '/ws/personal-pages';

const folder = {
  folderId: 'f1', parentFolderId: null, name: 'Notes', sortOrder: 1,
  createdBy: '', createdAt: 1, updatedAt: 1,
};
const page = {
  documentId: 'p1', teamProjectId: null, title: 'Reading list.md', documentType: 'markdown',
  parentFolderId: 'f1', createdBy: '', createdAt: 1, updatedAt: 1,
};

let pushHandlers: Array<(payload: unknown) => void>;
let invoke: ReturnType<typeof vi.fn>;

beforeEach(() => {
  pushHandlers = [];
  invoke = vi.fn(async (channel: string) => (
    channel === 'personal-pages:snapshot'
      ? { items: [page], containers: [folder] }
      : { ok: true }
  ));
  (globalThis as any).window = {
    electronAPI: {
      invoke,
      on: vi.fn((channel: string, handler: (payload: unknown) => void) => {
        if (channel === 'personal-pages:changed') pushHandlers.push(handler);
        return () => { pushHandlers = pushHandlers.filter((candidate) => candidate !== handler); };
      }),
    },
  };
});

afterEach(() => {
  delete (globalThis as any).window;
});

describe('PersonalPagesDataSource', () => {
  it('reads, writes and refreshes the personal tree over its IPC channels', async () => {
    const source = new PersonalPagesDataSource(WORKSPACE);

    await expect(source.snapshot()).resolves.toEqual({
      items: [page], containers: [folder], typePlacements: [],
    });
    expect(invoke).toHaveBeenCalledWith('personal-pages:snapshot', WORKSPACE);

    const register = {
      type: 'register-document' as const,
      documentId: 'p2', title: 'Ideas.md', documentType: 'markdown', parentFolderId: null,
    };
    // Local writes are committed when main answers, so registration is acked.
    await expect(source.command(register)).resolves.toMatchObject({ ok: true, registrationAcked: true });
    expect(invoke).toHaveBeenLastCalledWith('personal-pages:command', WORKSPACE, register);
    // A write main did not accept never reports success.
    invoke.mockResolvedValueOnce({ ok: false, error: 'disk full' });
    await expect(source.command(register)).rejects.toThrow('disk full');

    const changes: CollabDocsDataChange[] = [];
    const unsubscribe = source.subscribe((change) => changes.push(change));
    // The session only leaves `disconnected` on a status change.
    expect(changes).toEqual([{ type: 'status', status: 'connected' }]);
    changes.length = 0;

    invoke.mockClear();
    for (const handler of pushHandlers) handler({ workspacePath: '/ws/other' });
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalled();

    for (const handler of pushHandlers) handler({ workspacePath: WORKSPACE });
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    expect(changes[0]).toEqual({
      type: 'snapshot',
      snapshot: { items: [page], containers: [folder], typePlacements: [] },
    });

    unsubscribe();
    for (const handler of pushHandlers) handler({ workspacePath: WORKSPACE });
    await Promise.resolve();
    expect(changes).toHaveLength(1);
  });

  it('drops a page and a folder deleted in another window instead of leaving ghost rows', async () => {
    const scope = createPersonalCollabScope('/ws/personal-pages-removal');
    const source = new PersonalPagesDataSource('/ws/personal-pages-removal');
    const host = {
      personalState: { status: 'unavailable' },
      documents: {
        dataSource: source,
        loadViewPreferences: async () => null,
        saveViewPreferences: async () => undefined,
        documentTypes: () => [],
        createDocument: async () => undefined,
        readReceipts: { status: 'unavailable' },
      },
    };
    const session = createCollabDocsSession(scope, source, host as never);
    try {
      await session.start();
      expect(session.getDocuments().map((row) => row.documentId)).toEqual(['p1']);
      expect(session.getFolders().map((row) => row.folderId)).toEqual(['f1']);

      // Another window deleted the folder and its page.
      invoke.mockImplementation(async (channel: string) => (
        channel === 'personal-pages:snapshot' ? { items: [], containers: [] } : { ok: true }
      ));
      store.set(personalPagesRevisionAtomFamily('/ws/personal-pages-removal'), (revision) => revision + 1);

      await vi.waitFor(() => expect(session.getDocuments()).toEqual([]));
      expect(session.getFolders()).toEqual([]);
    } finally {
      pruneCollabDocsSession(scope.scopeKey);
    }
  });
});
