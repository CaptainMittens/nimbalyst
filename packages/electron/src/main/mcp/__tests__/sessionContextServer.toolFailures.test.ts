// @vitest-environment node
/**
 * The `get_tool_failures` handler, tested at two seams: a fake `MessageRowDb`
 * (what the handler asks and what it returns) and a real database on both
 * backends (that the SQL itself works on PGLite and SQLite).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it, vi } from 'vitest';
import { SQLiteDatabase } from '../../database/sqlite/SQLiteDatabase';
import { fetchToolFailures, type MessageRowDb } from '../sessionContextServer';

interface DbRow {
  session_id: string;
  created_at: string;
  content: string;
  message_kind: string;
  hidden: boolean;
  session_created_at: string;
}

/**
 * Builds the two rows of one Claude Code tool call, the call and its result
 *
 * Args:
 *     id::string
 *         The tool call id that joins the two rows.
 *     failed::boolean
 *         True when the result row carries `is_error`.
 *     text::string
 *         The result text.
 *     sessionId::string(=s1)
 *         The session that owns the rows.
 *     at::string(=2026-11-20T10:00:00.000Z)
 *         When both rows were written, as ISO text.
 *
 * Returns:
 *     DbRow[]
 *         The `tool_use` row, then the `tool_result` row.
 */
function bashCall(id: string, failed: boolean, text: string, sessionId = 's1', at = '2026-11-20T10:00:00.000Z'): DbRow[] {
  const base = { session_id: sessionId, created_at: at, message_kind: 'tool', hidden: false, session_created_at: at };
  return [
    { ...base, content: JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: {} }] } }) },
    { ...base, content: JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: failed, content: text }] } }) },
  ];
}

/** Makes a fake database that answers every query with the same rows and records each call. */
function makeDb(rows: DbRow[] = []) {
  const query = vi.fn(async (_sql: string, _params: unknown[] = []) => ({ rows }));
  return { db: { query } as unknown as MessageRowDb, query };
}

describe('fetchToolFailures with a fake database', () => {
  it('passes the workspace id and the start of the since day as query params', async () => {
    const { db, query } = makeDb(bashCall('c1', true, 'Exit code 1\nboom'));

    const result = await fetchToolFailures(db, '/ws/one', {
      since: '2026-11-20T15:30:00.000Z',
      currentSessionId: 'me',
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [, params] = query.mock.calls[0];
    expect(params?.[0]).toBe('/ws/one');
    expect(params?.[1]).toBe('2026-11-20T00:00:00.000Z');
    expect('error' in result).toBe(false);
    expect((result as { days: unknown[] }).days).toEqual([
      { day: '2026-11-20', bucket: 'habit', key: 'Bash:exit-code', calls: 1, failures: 1 },
    ]);
  });

  it('leaves out the pass sessions and always the calling session', async () => {
    const { db, query } = makeDb();

    await fetchToolFailures(db, '/ws/one', {
      since: '2026-11-20T00:00:00.000Z',
      excludeSessionIds: ['pass-1', 'pass-2'],
      currentSessionId: 'me',
    });
    await fetchToolFailures(db, '/ws/one', { since: '2026-11-20T00:00:00.000Z', currentSessionId: 'me' });
    await fetchToolFailures(db, '/ws/one', {
      since: '2026-11-20T00:00:00.000Z',
      excludeSessionIds: ['me', 'pass-1'],
      currentSessionId: 'me',
    });

    expect(query.mock.calls[0][1]?.[2]).toEqual(['pass-1', 'pass-2', 'me']);
    expect(query.mock.calls[1][1]?.[2]).toEqual(['me']);
    // A caller listed twice is sent once.
    expect(query.mock.calls[2][1]?.[2]).toEqual(['me', 'pass-1']);
  });

  it('returns the id of the calling session as callerSessionId', async () => {
    const { db } = makeDb();

    const result = await fetchToolFailures(db, '/ws/one', { since: '2026-11-20T00:00:00.000Z', currentSessionId: 'me' });

    expect((result as { callerSessionId: string }).callerSessionId).toBe('me');
  });

  it('gives each habitKeys input a verdict from the before and after windows', async () => {
    // 10 of 20 Bash calls failed before the lesson, 2 of 20 after it, in a newer session.
    const calls = (prefix: string, failures: number, session: string, at: string) =>
      Array.from({ length: 20 }, (_, i) => bashCall(`${prefix}${i}`, i < failures, 'Exit code 1\nboom', session, at)).flat();
    const { db } = makeDb([
      ...calls('old', 10, 'old-session', '2026-11-10T10:00:00.000Z'),
      ...calls('new', 2, 'new-session', '2026-11-22T10:00:00.000Z'),
    ]);
    const base = { since: '2026-11-06T00:00:00.000Z', currentSessionId: 'me' };

    const judged = await fetchToolFailures(db, '/ws/one', {
      ...base,
      habitKeys: [{ habitKey: 'Bash:exit-code', activatedAt: '2026-11-20T12:00:00.000Z' }],
    });
    const unjudged = await fetchToolFailures(db, '/ws/one', base);

    expect((judged as { verdicts: unknown[] }).verdicts).toEqual([
      {
        habitKey: 'Bash:exit-code',
        before: { calls: 20, failures: 10 },
        after: { calls: 20, failures: 2 },
        verdict: 'effective',
      },
    ]);
    expect((unjudged as { verdicts: unknown[] }).verdicts).toEqual([]);
  });

  it('clamps a since far in the past to 60 days before now, without an error', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-24T12:00:00.000Z'));
    try {
      const { db, query } = makeDb();

      const result = await fetchToolFailures(db, '/ws/one', { since: '0001-01-01T00:00:00.000Z', currentSessionId: 'me' });
      await fetchToolFailures(db, '/ws/one', { since: '2026-11-20T15:30:00.000Z', currentSessionId: 'me' });

      expect(result).not.toHaveProperty('error');
      // 60 days before 2026-11-24 is 2026-09-25; the start of that UTC day.
      expect(query.mock.calls[0][1]?.[1]).toBe('2026-09-25T00:00:00.000Z');
      // A recent since is left alone.
      expect(query.mock.calls[1][1]?.[1]).toBe('2026-11-20T00:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['a missing since', { currentSessionId: 'me' }, 'since'],
    ['a since that is not a time', { since: 'last week', currentSessionId: 'me' }, 'since'],
    ['an excludeSessionIds that is not a list of text', { since: '2026-11-20T00:00:00.000Z', excludeSessionIds: [1], currentSessionId: 'me' }, 'excludeSessionIds'],
    ['a habitKeys that is not a list', { since: '2026-11-20T00:00:00.000Z', habitKeys: 'Bash:exit-code', currentSessionId: 'me' }, 'habitKeys'],
    ['a habit key with no activatedAt time', { since: '2026-11-20T00:00:00.000Z', habitKeys: [{ habitKey: 'Bash:exit-code' }], currentSessionId: 'me' }, 'habitKeys'],
    ['a missing currentSessionId', { since: '2026-11-20T00:00:00.000Z' }, 'currentSessionId'],
  ])('returns an error result for %s and never asks the database', async (_label, args, field) => {
    const { db, query } = makeDb();

    const result = await fetchToolFailures(db, '/ws/one', args as never);

    expect(result).toEqual({ error: expect.stringContaining(field) });
    expect(query).not.toHaveBeenCalled();
  });

  it('returns an error result when the workspace id is empty', async () => {
    const { db, query } = makeDb();

    const result = await fetchToolFailures(db, '', { since: '2026-11-20T00:00:00.000Z', currentSessionId: 'me' });

    expect(result).toEqual({ error: expect.stringContaining('workspace') });
    expect(query).not.toHaveBeenCalled();
  });
});

/**
 * Opens an empty database on one backend with the two tables the query reads
 *
 * Args:
 *     backend::`'sqlite' | 'pglite'`
 *         The backend. SQLite uses the real schema files, PGLite a small copy.
 *     dir::string
 *         A temp folder for the SQLite file.
 *
 * Returns:
 *     `Promise<SQLiteDatabase | PGlite>`
 *         The open database.
 */
async function openBackend(backend: 'sqlite' | 'pglite', dir: string): Promise<SQLiteDatabase | PGlite> {
  if (backend === 'sqlite') {
    const db = new SQLiteDatabase({ dbDir: dir, schemaDir: path.resolve(__dirname, '../../database/sqlite/schemas'), sampleRate: 0 });
    await db.initialize();
    return db;
  }
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE ai_sessions (
      id TEXT PRIMARY KEY, provider TEXT, workspace_id TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
    CREATE TABLE ai_agent_messages (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      source TEXT NOT NULL,
      direction TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata JSONB,
      hidden BOOLEAN NOT NULL DEFAULT FALSE,
      message_kind TEXT
    );
  `);
  return db;
}

/** Puts one session and its tool call rows into the database. */
async function seedSession(
  db: SQLiteDatabase | PGlite,
  sessionId: string,
  workspaceId: string,
  calls: { id: string; failed: boolean; text: string; at: string }[],
): Promise<void> {
  await db.query(
    `INSERT INTO ai_sessions (id, provider, workspace_id, created_at) VALUES ($1, 'claude-code', $2, $3)`,
    [sessionId, workspaceId, new Date('2026-11-01T00:00:00.000Z')],
  );
  for (const call of calls) {
    for (const row of bashCall(call.id, call.failed, call.text, sessionId, call.at)) {
      await db.query(
        `INSERT INTO ai_agent_messages (session_id, created_at, source, direction, content, message_kind)
         VALUES ($1, $2, 'claude-code', 'output', $3, 'tool')`,
        [sessionId, new Date(row.created_at), row.content],
      );
    }
  }
}

const BLOCKED_TEXT = '[plan-gate] BLOCKED: state the plan before editing';
const EXIT_TEXT = 'Exit code 1\nboom';

describe.each(['sqlite', 'pglite'] as const)('fetchToolFailures SQL on %s', (backend) => {
  it('keeps this workspace, this period and other sessions, and counts a blocked call', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tool-failures-'));
    const db = await openBackend(backend, dir);
    try {
      // The kept session: one call before the cut, one exactly on it, one blocked call later.
      await seedSession(db, 'kept', '/project', [
        { id: 'k0', failed: true, text: EXIT_TEXT, at: '2026-11-14T23:59:59.000Z' },
        { id: 'k1', failed: true, text: EXIT_TEXT, at: '2026-11-15T00:00:00.000Z' },
        { id: 'k2', failed: true, text: BLOCKED_TEXT, at: '2026-11-20T10:00:00.000Z' },
      ]);
      // Each of these would add a failure on 2026-11-20 if the query let it through.
      const leak = [{ id: 'x', failed: true, text: BLOCKED_TEXT, at: '2026-11-20T10:00:00.000Z' }];
      await seedSession(db, 'caller', '/project', leak);
      await seedSession(db, 'pass-1', '/project', leak);
      await seedSession(db, 'elsewhere', '/other-project', leak);

      const result = await fetchToolFailures(db as unknown as MessageRowDb, '/project', {
        since: '2026-11-15T09:30:00.000Z',
        excludeSessionIds: ['pass-1'],
        currentSessionId: 'caller',
      });

      expect(result).not.toHaveProperty('error');
      const { days, callerSessionId } = result as { days: { day: string }[]; callerSessionId: string };
      expect([...days].sort((a, b) => a.day.localeCompare(b.day))).toEqual([
        { day: '2026-11-15', bucket: 'habit', key: 'Bash:exit-code', calls: 1, failures: 1 },
        { day: '2026-11-20', bucket: 'blocked', key: 'plan-gate', calls: 1, failures: 1 },
      ]);
      expect(callerSessionId).toBe('caller');
    } finally {
      await db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads every session when the exclusion list holds only the caller', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tool-failures-'));
    const db = await openBackend(backend, dir);
    try {
      await seedSession(db, 'one', '/project', [{ id: 'a', failed: true, text: BLOCKED_TEXT, at: '2026-11-20T10:00:00.000Z' }]);
      await seedSession(db, 'two', '/project', [{ id: 'b', failed: true, text: BLOCKED_TEXT, at: '2026-11-20T11:00:00.000Z' }]);

      const result = await fetchToolFailures(db as unknown as MessageRowDb, '/project', {
        since: '2026-11-15T00:00:00.000Z',
        currentSessionId: 'nobody',
      });

      expect((result as { days: unknown[] }).days).toEqual([
        { day: '2026-11-20', bucket: 'blocked', key: 'plan-gate', calls: 2, failures: 2 },
      ]);
    } finally {
      await db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
