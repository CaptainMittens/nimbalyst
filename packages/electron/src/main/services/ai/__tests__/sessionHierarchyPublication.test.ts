import { expect, it, vi } from 'vitest';
vi.mock('@nimbalyst/runtime/storage/repositories/AISessionsRepository', () => ({ AISessionsRepository: { get: vi.fn() } }));
vi.mock('../../../utils/logger', () => ({ logger: { main: { warn: vi.fn() } } }));
import { createHierarchyPublisher } from '../../sync/sessionHierarchyPublication';

it('retains an unpublished canonical rejection and reads fresh state on named retry', async () => {
  let parentSessionId: string | null = null;
  const push = vi.fn().mockResolvedValueOnce({ published: false, retryable: true }).mockResolvedValue({ published: true });
  const publisher = createHierarchyPublisher({ get: async () => ({ parentSessionId, createdBySessionId: parentSessionId, isArchived: false }) as any, push, warn: vi.fn() });
  try {
    await publisher.publish('child');
    expect(push.mock.calls[0]).toEqual(['child', { parentSessionId: null, createdBySessionId: null, isArchived: false }, expect.any(Function)]);
    expect(publisher.pendingCount()).toBe(1);
    parentSessionId = 'newer-manager';
    await publisher.retry();
    expect(push.mock.calls[1][1]).toMatchObject({ parentSessionId: 'newer-manager', createdBySessionId: 'newer-manager' });
    expect(publisher.pendingCount()).toBe(0);
  } finally { publisher.pause(); }
});
