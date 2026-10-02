// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { setPageType, type SetPageTypeDependencies } from '../setPageType';

const PAGE = { documentId: 'doc-1', title: 'Sync engine', documentType: 'markdown', parentId: 'overview' };
const BODY = '# Sync engine\n\nMoves documents between clients.\n';
const COPY = { markdown: BODY, version: 4 };

function harness(overrides: Partial<SetPageTypeDependencies> = {}) {
  const calls: string[] = [];
  const record = <T>(name: string, value: T) => (...args: unknown[]) => {
    calls.push(`${name}:${args.map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(',')}`);
    return value;
  };
  const dependencies: SetPageTypeDependencies = {
    childCount: vi.fn(() => 0),
    flushPageEditor: vi.fn(record('flush', Promise.resolve())),
    readPageMarkdown: vi.fn(record('read', Promise.resolve(COPY))),
    createItem: vi.fn(record('create', Promise.resolve({ itemId: 'mod_1', publication: 'published' as const }))),
    verifyItemBody: vi.fn(record('verify', Promise.resolve({ status: 'match' as const }))),
    removeItem: vi.fn(record('remove', Promise.resolve())),
    setItemPlacement: vi.fn(record('place', Promise.resolve({ ok: true as const }))),
    pageUnchangedSince: vi.fn(record('recheck', Promise.resolve(true))),
    trashPage: vi.fn(record('trash', Promise.resolve())),
    openItem: vi.fn(record('open', undefined)),
    wait: vi.fn(async () => {}),
    ...overrides,
  };
  return { dependencies, calls };
}

const run = (dependencies: SetPageTypeDependencies, lane: 'team' | 'personal' = 'team') =>
  setPageType({ lane, page: PAGE, typeId: 'module' }, dependencies);

describe('setPageType', () => {
  it('flushes, copies, verifies, places, re-checks the page, then trashes it and opens the item', async () => {
    const { dependencies, calls } = harness();

    expect(await run(dependencies)).toEqual({ status: 'done', itemId: 'mod_1' });
    expect(calls).toEqual([
      'flush:doc-1',
      'read:doc-1',
      `create:${JSON.stringify({ typeId: 'module', title: 'Sync engine', markdown: BODY })}`,
      `verify:mod_1,${BODY}`,
      'place:mod_1,overview',
      `recheck:doc-1,${JSON.stringify(COPY)}`,
      'trash:doc-1',
      'open:mod_1,doc-1',
    ]);
  });

  it('refuses a page with child pages, or with images or decision answers bound to its room, before creating anything', async () => {
    const parent = harness({ childCount: vi.fn(() => 2) });
    const parentOutcome = await run(parent.dependencies);
    expect(parentOutcome.status === 'refused' && parentOutcome.message).toMatch(/2 pages inside it/);
    expect(parent.dependencies.readPageMarkdown).not.toHaveBeenCalled();

    for (const markdown of ['![chart](collab-asset://doc/doc-1/asset/abc)\n', 'Intro\n\n```decision\nid: d1\n```\n']) {
      const { dependencies } = harness({ readPageMarkdown: vi.fn(async () => ({ markdown })) });
      expect((await run(dependencies)).status).toBe('refused');
      expect(dependencies.createItem).not.toHaveBeenCalled();
    }
  });

  it('creates nothing when the open editor cannot be flushed or the page cannot be read', async () => {
    for (const override of [
      { flushPageEditor: vi.fn(async () => { throw new Error('unsaved edits'); }) },
      { readPageMarkdown: vi.fn(async () => { throw new Error('Timed out hydrating'); }) },
    ]) {
      const { dependencies } = harness(override);
      expect(await run(dependencies)).toMatchObject({ status: 'failed', itemKept: false });
      expect(dependencies.createItem).not.toHaveBeenCalled();
    }
  });

  it('removes an item that never reached the team, leaving the page untouched', async () => {
    const { dependencies } = harness({
      createItem: vi.fn(async () => ({ itemId: 'mod_1', publication: 'pending' as const, error: 'Saved locally. Team sync is not connected.' })),
    });

    const outcome = await run(dependencies);

    expect(outcome).toMatchObject({ status: 'failed', itemId: 'mod_1', itemKept: false });
    expect(outcome.status === 'failed' && outcome.message).toMatch(/Team sync is not connected/);
    expect(dependencies.verifyItemBody).not.toHaveBeenCalled();
    expect(dependencies.removeItem).toHaveBeenCalledWith('mod_1');
    expect(dependencies.trashPage).not.toHaveBeenCalled();
  });

  it('retries an unreadable read-back, and never deletes a published item that still cannot be read', async () => {
    const unreadable = vi.fn(async () => ({ status: 'unreadable' as const, reason: 'room unreachable' }));
    const team = harness({ verifyItemBody: unreadable });

    const outcome = await run(team.dependencies);

    expect(unreadable).toHaveBeenCalledTimes(3);
    expect(team.dependencies.wait).toHaveBeenCalledTimes(2);
    expect(outcome).toMatchObject({ status: 'failed', itemId: 'mod_1', itemKept: true });
    expect(team.dependencies.removeItem).not.toHaveBeenCalled();
    expect(team.dependencies.trashPage).not.toHaveBeenCalled();

    // Read-back succeeding on a retry carries on as normal.
    const flaky = vi.fn()
      .mockResolvedValueOnce({ status: 'unreadable', reason: 'syncing' })
      .mockResolvedValueOnce({ status: 'match' });
    const recovered = harness({ verifyItemBody: flaky });
    expect(await run(recovered.dependencies)).toEqual({ status: 'done', itemId: 'mod_1' });

    // A local personal item nobody else can reach is still cleaned up.
    const personal = harness({
      createItem: vi.fn(async () => ({ itemId: 'idea_1', publication: 'local' as const })),
      verifyItemBody: vi.fn(async () => ({ status: 'unreadable' as const, reason: 'not found' })),
    });
    expect(await run(personal.dependencies, 'personal')).toMatchObject({ status: 'failed', itemKept: false });
    expect(personal.dependencies.removeItem).toHaveBeenCalledWith('idea_1');
  });

  it('keeps the item and the page when the read-back differs', async () => {
    const { dependencies } = harness({ verifyItemBody: vi.fn(async () => ({ status: 'mismatch' as const })) });

    expect(await run(dependencies)).toMatchObject({ status: 'failed', itemId: 'mod_1', itemKept: true });
    expect(dependencies.removeItem).not.toHaveBeenCalled();
    expect(dependencies.trashPage).not.toHaveBeenCalled();
  });

  it('keeps the page when the placement is not confirmed, saying the item sits under its type', async () => {
    const { dependencies } = harness({
      setItemPlacement: vi.fn(async () => ({ ok: false as const, error: 'timed out' })),
    });

    const outcome = await run(dependencies);

    expect(outcome).toMatchObject({ status: 'failed', itemId: 'mod_1', itemKept: true });
    expect(outcome.status === 'failed' && outcome.message).toMatch(/under its type/);
    expect(dependencies.removeItem).not.toHaveBeenCalled();
    expect(dependencies.pageUnchangedSince).not.toHaveBeenCalled();
    expect(dependencies.trashPage).not.toHaveBeenCalled();
  });

  it('keeps both when the page changed after the copy, or the trash itself fails', async () => {
    const changed = harness({ pageUnchangedSince: vi.fn(async () => false) });
    const changedOutcome = await run(changed.dependencies);
    expect(changedOutcome).toMatchObject({ status: 'failed', itemId: 'mod_1', itemKept: true });
    expect(changedOutcome.status === 'failed' && changedOutcome.message).toMatch(/changed/);
    expect(changed.dependencies.trashPage).not.toHaveBeenCalled();
    expect(changed.dependencies.removeItem).not.toHaveBeenCalled();

    const trashFails = harness({ trashPage: vi.fn(async () => { throw new Error('offline'); }) });
    expect(await run(trashFails.dependencies)).toMatchObject({ status: 'failed', itemId: 'mod_1', itemKept: true });
    expect(trashFails.dependencies.removeItem).not.toHaveBeenCalled();
    expect(trashFails.dependencies.openItem).toHaveBeenCalledWith('mod_1', 'doc-1');
  });
});
