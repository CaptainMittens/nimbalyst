// @vitest-environment node
/**
 * Personal pages live in the app database with no account. They must survive a
 * second launch, so these tests run on the real SQLite engine with the real
 * migrations (0049 included) and reopen the database directory between steps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', async () => ({
  app: {
    getPath: (await import('../../../../test-stubs/privateUserData')).testApp.getPath,
    getName: vi.fn(() => 'test'),
    getVersion: vi.fn(() => '1'),
    on: vi.fn(),
  },
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('../../database/initialize', () => ({ getDatabase: () => null }));
vi.mock('../../HistoryManager', () => ({ historyManager: { createSnapshot: vi.fn() } }));

import { SQLiteDatabase } from '../../database/sqlite/SQLiteDatabase';
import { PersonalPagesService, personalDocHistoryKey } from '../PersonalPagesService';

const SCHEMA_DIR = path.resolve(__dirname, '..', '..', 'database', 'sqlite', 'schemas');
const WS = '/ws/personal-pages';

describe('PersonalPagesService', () => {
  let tmp: string;
  let db: SQLiteDatabase;
  const history = { createSnapshot: vi.fn(async () => undefined) };
  const notify = vi.fn();

  const open = async () => {
    db = new SQLiteDatabase({
      dbDir: path.join(tmp, 'sqlite-db'),
      schemaDir: SCHEMA_DIR,
      slowQueryThresholdMs: 1000,
      sampleRate: 0,
    });
    await db.initialize();
    return new PersonalPagesService({ db: () => db, history, notify });
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-personal-pages-'));
    history.createSnapshot.mockClear();
    notify.mockClear();
  });

  afterEach(async () => {
    await db?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('keeps folders, placements, documents and bodies across a second launch', async () => {
    let service = await open();
    await service.command(WS, { type: 'register-folder', folderId: 'f1', name: 'Specs', parentFolderId: null, sortOrder: 1 });
    await service.command(WS, { type: 'set-type-placement', typeId: 'decision', parentFolderId: 'f1', sortOrder: 2 });
    await service.command(WS, {
      type: 'register-document', documentId: 'd1', title: 'Intro', documentType: 'markdown', parentFolderId: 'f1',
      metadata: { metadataVersion: 2, fileExtension: '.md', editorId: 'markdown' },
    });
    expect(await service.updateBody(WS, 'd1', '# Hello', 0)).toEqual({ version: 1 });
    expect(history.createSnapshot).toHaveBeenCalledWith(
      personalDocHistoryKey('d1'), '# Hello', 'auto-save', 'Auto-save',
    );
    expect(notify).toHaveBeenCalledWith(WS);
    service.dispose();
    await db.close();

    service = await open();
    const snapshot = await service.snapshot(WS);
    expect(snapshot.containers).toEqual([expect.objectContaining({ folderId: 'f1', name: 'Specs', parentFolderId: null, sortOrder: 1, createdBy: 'local' })]);
    expect(snapshot.typePlacements).toEqual([expect.objectContaining({ typeId: 'decision', parentFolderId: 'f1', sortOrder: 2, projectId: null })]);
    expect(snapshot.items).toEqual([expect.objectContaining({
      documentId: 'd1', title: 'Intro', documentType: 'markdown', parentFolderId: 'f1', teamProjectId: null,
      metadataVersion: 2, fileExtension: '.md', editorId: 'markdown', createdBy: 'local', trashedAt: null,
    })]);
    expect(typeof snapshot.items[0].createdAt).toBe('number');
    expect(await service.getBody(WS, 'd1')).toEqual({ content: '# Hello', version: 1 });
    // Another workspace sees none of it.
    expect((await service.snapshot('/ws/other')).items).toEqual([]);
  });

  it('trashes and restores a document without deleting it', async () => {
    const service = await open();
    await service.command(WS, { type: 'register-document', documentId: 'd1', title: 'Doc', documentType: 'markdown', parentFolderId: null });
    await service.command(WS, { type: 'trash-document', documentId: 'd1', trashedAt: 1_700_000_000_000 });
    expect((await service.snapshot(WS)).items[0].trashedAt).toBe(1_700_000_000_000);
    await service.command(WS, { type: 'restore-document', documentId: 'd1' });
    expect((await service.snapshot(WS)).items[0].trashedAt).toBeNull();
  });

  it('refuses to move a folder into its own descendant', async () => {
    const service = await open();
    await service.command(WS, { type: 'register-folder', folderId: 'a', name: 'A', parentFolderId: null, sortOrder: 0 });
    await service.command(WS, { type: 'register-folder', folderId: 'b', name: 'B', parentFolderId: 'a', sortOrder: 0 });
    await expect(service.command(WS, { type: 'move-folder', folderId: 'a', parentFolderId: 'b' })).rejects.toThrow(/cycle|descendant/i);
    await expect(service.command(WS, { type: 'move-folder', folderId: 'a', parentFolderId: 'a' })).rejects.toThrow();
    const folders = (await service.snapshot(WS)).containers;
    expect(folders.find((f) => f.folderId === 'a')?.parentFolderId).toBeNull();
  });

  it('removes a folder subtree with its documents and placements', async () => {
    const service = await open();
    await service.command(WS, { type: 'register-folder', folderId: 'a', name: 'A', parentFolderId: null, sortOrder: 0 });
    await service.command(WS, { type: 'register-folder', folderId: 'b', name: 'B', parentFolderId: 'a', sortOrder: 0 });
    await service.command(WS, { type: 'register-document', documentId: 'd1', title: 'Deep', documentType: 'markdown', parentFolderId: 'b' });
    await service.command(WS, { type: 'register-document', documentId: 'd2', title: 'Root', documentType: 'markdown', parentFolderId: null });
    await service.command(WS, { type: 'set-type-placement', typeId: 'bug', parentFolderId: 'b', sortOrder: 0 });
    await service.command(WS, { type: 'remove-folder', folderId: 'a' });
    const snapshot = await service.snapshot(WS);
    expect(snapshot.containers).toEqual([]);
    expect(snapshot.typePlacements).toEqual([]);
    expect(snapshot.items.map((d) => d.documentId)).toEqual(['d2']);
  });

  it('keeps a folder moved out of the subtree before the removal, even mid-removal', async () => {
    const service = await open();
    const seed = async (svc: PersonalPagesService) => {
      await svc.command(WS, { type: 'register-folder', folderId: 'a', name: 'A', parentFolderId: null, sortOrder: 0 });
      await svc.command(WS, { type: 'register-folder', folderId: 'b', name: 'B', parentFolderId: 'a', sortOrder: 0 });
      await svc.command(WS, { type: 'register-document', documentId: 'in-b', title: 'In B', documentType: 'markdown', parentFolderId: 'b' });
    };
    const survivors = async () => {
      const snapshot = await service.snapshot(WS);
      return { folders: snapshot.containers.map((f) => f.folderId), docs: snapshot.items.map((d) => d.documentId) };
    };

    // Sequential: the move lands first.
    await seed(service);
    await service.command(WS, { type: 'move-folder', folderId: 'b', parentFolderId: null });
    await service.command(WS, { type: 'remove-folder', folderId: 'a' });
    expect(await survivors()).toEqual({ folders: ['b'], docs: ['in-b'] });
    await service.command(WS, { type: 'remove-folder', folderId: 'b' });

    // Interleaved: the move commits after remove-folder has started, right
    // before its transaction takes the write lock. Membership captured any
    // earlier would still delete B.
    await seed(service);
    const racing = new PersonalPagesService({
      db: () => ({
        query: (sql, params) => db.query(sql, params),
        runTransaction: async (statements) => {
          await service.command(WS, { type: 'move-folder', folderId: 'b', parentFolderId: null });
          return db.runTransaction(statements);
        },
      }),
      history,
      notify,
    });
    await racing.command(WS, { type: 'remove-folder', folderId: 'a' });
    expect(await survivors()).toEqual({ folders: ['b'], docs: ['in-b'] });
  });

  it('returns a conflict with the current content on a stale expectedVersion', async () => {
    const service = await open();
    await service.command(WS, { type: 'register-document', documentId: 'd1', title: 'Doc', documentType: 'markdown', parentFolderId: null });
    await service.updateBody(WS, 'd1', 'first', 0);
    await service.updateBody(WS, 'd1', 'second', 1);
    expect(await service.updateBody(WS, 'd1', 'stale', 1)).toEqual({ conflict: true, version: 2, content: 'second' });
    expect(await service.getBody(WS, 'd1')).toEqual({ content: 'second', version: 2 });
  });

  it('requires a workspace path', async () => {
    const service = await open();
    await expect(service.snapshot('')).rejects.toThrow(/workspacePath/);
  });
});

describe('PersonalPagesService on PGLite', () => {
  // Runs the worker.js mirror DDL itself, so the PGLite schema cannot drift
  // from what this store queries without failing here.
  const mirrorDdl = () => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'database', 'worker.js'), 'utf8');
    const start = source.indexOf('Mirror of SQLite migration 0049');
    const ddl = source.slice(start).match(/exec\(`([\s\S]*?)`\)/);
    if (start < 0 || !ddl) throw new Error('0049 mirror block not found in worker.js');
    return ddl[1];
  };

  it('round-trips the tree, trash timestamps and a body conflict', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const pglite = new PGlite();
    await pglite.exec(mirrorDdl());
    const db = {
      query: (sql: string, params?: unknown[]) => pglite.query(sql, params) as Promise<{ rows: any[] }>,
      runTransaction: async (statements: Array<{ sql: string; params?: unknown[] }>) => {
        await pglite.transaction(async (tx) => {
          for (const statement of statements) await tx.query(statement.sql, statement.params);
        });
      },
    };
    const service = new PersonalPagesService({ db: () => db, history: { createSnapshot: vi.fn(async () => undefined) }, notify: vi.fn() });
    try {
      await service.command(WS, { type: 'register-folder', folderId: 'f1', name: 'Specs', parentFolderId: null, sortOrder: 1.5 });
      await service.command(WS, { type: 'set-type-placement', typeId: 'bug', parentFolderId: 'f1', sortOrder: 0 });
      await service.command(WS, { type: 'register-document', documentId: 'd1', title: 'Doc', documentType: 'markdown', parentFolderId: 'f1' });
      await service.command(WS, { type: 'trash-document', documentId: 'd1', trashedAt: 1_700_000_000_000 });
      await service.updateBody(WS, 'd1', 'first', 0);
      expect(await service.updateBody(WS, 'd1', 'stale', 0)).toEqual({ conflict: true, version: 1, content: 'first' });

      const snapshot = await service.snapshot(WS);
      expect(snapshot.containers[0]).toMatchObject({ folderId: 'f1', sortOrder: 1.5 });
      expect(snapshot.items[0]).toMatchObject({ documentId: 'd1', trashedAt: 1_700_000_000_000, parentFolderId: 'f1' });
      expect(typeof snapshot.items[0].createdAt).toBe('number');

      await service.command(WS, { type: 'remove-folder', folderId: 'f1' });
      expect(await service.snapshot(WS)).toEqual({ items: [], containers: [], typePlacements: [] });
    } finally {
      await pglite.close();
    }
  });
});
