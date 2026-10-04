// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { CollabDocsSession } from '@nimbalyst/collab-client/docs';

vi.mock('../../../services/HeadlessCollabDocument', () => ({ readHeadlessCollabDocContent: vi.fn() }));
vi.mock('../../../services/DocumentReplicaCache', () => ({ buildDocumentReplicaCacheKey: vi.fn(), getDocumentReplicaCache: vi.fn() }));
vi.mock('../../../services/ErrorNotificationService', () => ({ errorNotificationService: { showWarning: vi.fn(), showError: vi.fn() } }));
vi.mock('../../../utils/collabDocumentOpener', () => ({ getCollabConfig: vi.fn() }));
vi.mock('../usePersonalPageBody', () => ({ flushPersonalPageBody: vi.fn() }));

import { buildSetPageTypeDependencies } from '../useSetPageType';

describe('buildSetPageTypeDependencies', () => {
  // The session reports a refused trash as a result, not a throw; Set type
  // only keeps both pages (and says so) when trashPage rejects.
  it('fails the page trash when the session refuses it', async () => {
    const session = {
      trashDocument: vi.fn(async () => ({ ok: false as const, error: 'shared documents are offline' })),
    } as unknown as CollabDocsSession;
    const dependencies = buildSetPageTypeDependencies(
      { lane: 'team', workspacePath: '/ws', session, teamScope: null, tabsActions: {} as never },
      'Sync engine',
    );
    await expect(dependencies.trashPage('page-1')).rejects.toThrow('shared documents are offline');

    vi.mocked(session.trashDocument).mockResolvedValueOnce({ ok: true });
    await expect(dependencies.trashPage('page-1')).resolves.toBeUndefined();
  });
});
