// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  BLOCKED_PATTERNS,
  deriveToolFailures,
  evaluateHabitKeys,
  type ToolFailureRow,
} from '../toolFailures';

const DAY1 = '2026-11-20T09:00:00.000Z';

function row(partial: Partial<ToolFailureRow>): ToolFailureRow {
  return {
    content: '',
    message_kind: 'tool',
    searchable_text: null,
    metadata: null,
    hidden: false,
    session_id: 's1',
    created_at: DAY1,
    ...partial,
  };
}

/** A Claude Code assistant row that calls one tool. */
function useRow(id: string, name: string, extra: Partial<ToolFailureRow> = {}): ToolFailureRow {
  return row({
    content: JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id, name, input: {} }] },
    }),
    ...extra,
  });
}

/** A Claude Code user row that carries one tool_result. */
function resultRow(
  toolUseId: string,
  text: string,
  isError = true,
  extra: Partial<ToolFailureRow> = {},
): ToolFailureRow {
  return row({
    content: JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError, content: text }],
      },
    }),
    ...extra,
  });
}

/** One call and its result, as two rows. */
function claudeCall(
  id: string,
  name: string,
  text: string,
  isError = true,
  extra: Partial<ToolFailureRow> = {},
): ToolFailureRow[] {
  return [useRow(id, name, extra), resultRow(id, text, isError, extra)];
}

/** One Codex commandExecution call, as an item/started row and an item/completed row. */
function codexCommand(id: string, completed: Record<string, unknown>, extra: Partial<ToolFailureRow> = {}) {
  return [
    row({
      content: JSON.stringify({
        method: 'item/started',
        params: { item: { type: 'commandExecution', id, command: 'npm test' } },
      }),
      ...extra,
    }),
    row({
      content: JSON.stringify({
        method: 'item/completed',
        params: { item: { type: 'commandExecution', id, command: 'npm test', ...completed } },
      }),
      ...extra,
    }),
  ];
}

describe('deriveToolFailures: blocked calls', () => {
  it('counts a hook-blocked Edit as blocked and never as habit', () => {
    const rows = claudeCall('t1', 'Edit', 'PreToolUse:Edit hook error: [plan-gate] BLOCKED: no plan yet');
    const result = deriveToolFailures(rows);
    expect(result.days).toEqual([
      { day: '2026-11-20', bucket: 'blocked', key: 'plan-gate', calls: 1, failures: 1 },
    ]);
    expect(result.habitCounts).toEqual([]);
    expect(result.brokenToolKeys).toEqual([]);
  });
});

describe('deriveToolFailures: the ExitPlanMode hook case', () => {
  it('keeps every ExitPlanMode call as the calls of the blocking hook and flags no broken tool', () => {
    const hookText =
      'PreToolUse:ExitPlanMode hook error: [plan-gate] BLOCKED: planFilePath is missing';
    const blocked = Array.from({ length: 10 }, (_, i) => claudeCall(`b${i}`, 'ExitPlanMode', hookText)).flat();
    const fine = Array.from({ length: 2 }, (_, i) => claudeCall(`ok${i}`, 'ExitPlanMode', 'Plan saved', false)).flat();
    const result = deriveToolFailures([...blocked, ...fine]);
    expect(result.days).toEqual([
      { day: '2026-11-20', bucket: 'blocked', key: 'plan-gate', calls: 12, failures: 10 },
    ]);
    expect(result.brokenToolKeys).toEqual([]);
    expect(result.habitCounts).toEqual([]);
  });
});

describe('deriveToolFailures: broken tools', () => {
  it('sends "No such tool available" to broken-tool at once, keyed by the tool', () => {
    const rows = claudeCall(
      'n1',
      'mcp__ghost__lookup',
      '<tool_use_error>Error: No such tool available: mcp__ghost__lookup</tool_use_error>',
    );
    const result = deriveToolFailures(rows);
    expect(result.days).toEqual([
      { day: '2026-11-20', bucket: 'broken-tool', key: 'mcp__ghost__lookup', calls: 1, failures: 1 },
    ]);
    expect(result.brokenToolKeys).toEqual([{ key: 'mcp__ghost__lookup', calls: 1, failures: 1 }]);
    expect(result.habitCounts).toEqual([]);
  });
});

/** One MCP call whose result `content` is an array of items, as MCP tools store it. */
function mcpCall(id: string, name: string, items: unknown[]): ToolFailureRow[] {
  const result = row({
    content: JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: items }] },
    }),
  });
  return [useRow(id, name), result];
}

describe('deriveToolFailures: MCP results with array content', () => {
  it('reads a hook-block message inside the array as a blocked call with the real sample text', () => {
    const block = 'PreToolUse:mcp__x__run hook error: [plan-gate] BLOCKED: plan first';
    const rows = mcpCall('m1', 'mcp__x__run', [{ type: 'image', source: {} }, { type: 'text', text: block }]);
    const result = deriveToolFailures(rows);
    expect(result.days).toEqual([
      { day: '2026-11-20', bucket: 'blocked', key: 'plan-gate', calls: 1, failures: 1 },
    ]);
    expect(result.samples).toEqual([{ key: 'plan-gate', sessionId: 's1', text: block }]);
  });

  it('joins the text items with a newline and finds "No such tool available" in the array', () => {
    const rows = mcpCall('m2', 'mcp__ghost__lookup', [
      { type: 'image', source: {} },
      { type: 'text', text: '<tool_use_error>Error: No such tool available: mcp__ghost__lookup</tool_use_error>' },
      { type: 'text', text: 'second line' },
    ]);
    const result = deriveToolFailures(rows);
    expect(result.brokenToolKeys).toEqual([{ key: 'mcp__ghost__lookup', calls: 1, failures: 1 }]);
    expect(result.samples[0].text).toBe(
      '<tool_use_error>Error: No such tool available: mcp__ghost__lookup</tool_use_error>\nsecond line',
    );
  });
});

describe('deriveToolFailures: the broken-tool threshold', () => {
  const exit1 = 'Exit code 1\nboom';

  it('flags a tool with 10 calls and 9 non-blocked failures (90%) as broken', () => {
    const failing = Array.from({ length: 9 }, (_, i) => claudeCall(`f${i}`, 'Flaky', exit1)).flat();
    const fine = claudeCall('ok', 'Flaky', 'fine', false);
    const result = deriveToolFailures([...failing, ...fine]);
    expect(result.brokenToolKeys).toEqual([{ key: 'Flaky', calls: 10, failures: 9 }]);
    expect(result.days).toEqual([
      { day: '2026-11-20', bucket: 'broken-tool', key: 'Flaky', calls: 10, failures: 9 },
    ]);
    expect(result.habitCounts).toEqual([]);
  });
});

describe('deriveToolFailures: the broken-tool limits', () => {
  const exit1 = 'Exit code 1\nboom';

  it('does not flag a tool with 9 of 9 calls failing (too few calls)', () => {
    const failing = Array.from({ length: 9 }, (_, i) => claudeCall(`f${i}`, 'Flaky', exit1)).flat();
    const result = deriveToolFailures(failing);
    expect(result.brokenToolKeys).toEqual([]);
  });

  it('does not flag a tool with 8 of 10 calls failing (80%)', () => {
    const failing = Array.from({ length: 8 }, (_, i) => claudeCall(`f${i}`, 'Flaky', exit1)).flat();
    const fine = Array.from({ length: 2 }, (_, i) => claudeCall(`ok${i}`, 'Flaky', 'fine', false)).flat();
    const result = deriveToolFailures([...failing, ...fine]);
    expect(result.brokenToolKeys).toEqual([]);
  });

  it('leaves a tool that a hook blocks 10 of 10 times in blocked, not broken-tool', () => {
    const text = 'PreToolUse:Write hook error: [plan-gate] BLOCKED: plan first';
    const rows = Array.from({ length: 10 }, (_, i) => claudeCall(`w${i}`, 'Write', text)).flat();
    const result = deriveToolFailures(rows);
    expect(result.brokenToolKeys).toEqual([]);
    expect(result.days.map((d) => d.bucket)).toEqual(['blocked']);
  });
});

describe('deriveToolFailures: pairing', () => {
  const blockText = 'PreToolUse:Edit hook error: [plan-gate] BLOCKED: plan first';

  it('skips a row with hidden set, whether it is the call or the result', () => {
    const visible = claudeCall('a', 'Edit', blockText);
    const hiddenCall = [useRow('b', 'Edit', { hidden: true }), resultRow('b', blockText)];
    const hiddenResult = [useRow('c', 'Edit'), resultRow('c', blockText, true, { hidden: true })];
    const result = deriveToolFailures([...visible, ...hiddenCall, ...hiddenResult]);
    expect(result.days).toEqual([
      { day: '2026-11-20', bucket: 'blocked', key: 'plan-gate', calls: 1, failures: 1 },
    ]);
  });

  it('does not count a call that has no result, as a call or as a failure', () => {
    const paired = claudeCall('a', 'Edit', blockText);
    const result = deriveToolFailures([...paired, useRow('lonely', 'Edit')]);
    expect(result.days).toEqual([
      { day: '2026-11-20', bucket: 'blocked', key: 'plan-gate', calls: 1, failures: 1 },
    ]);
  });
});

describe('deriveToolFailures: habit keys', () => {
  it('files a non-zero exit under the key <tool>:exit-code and counts every call of the tool', () => {
    const rows = [
      ...claudeCall('x1', 'Bash', 'Exit code 1\nnpm ERR! missing script'),
      ...claudeCall('x2', 'Bash', 'ok', false),
    ];
    const result = deriveToolFailures(rows);
    expect(result.days).toEqual([
      { day: '2026-11-20', bucket: 'habit', key: 'Bash:exit-code', calls: 2, failures: 1 },
    ]);
    expect(result.habitCounts).toEqual([{ key: 'Bash:exit-code', hits: 1, distinctDays: 1 }]);
    expect(result.brokenToolKeys).toEqual([]);
  });
});

describe('deriveToolFailures: the habit gate numbers', () => {
  const at = (day: string) => ({ created_at: `${day}T10:00:00.000Z` });
  const fail = (id: string, day: string) => claudeCall(id, 'Bash', 'Exit code 2\nbad', true, at(day));

  it('reports 2 hits on 2 days (gate: no)', () => {
    const result = deriveToolFailures([...fail('a', '2026-11-20'), ...fail('b', '2026-11-21')]);
    expect(result.habitCounts).toEqual([{ key: 'Bash:exit-code', hits: 2, distinctDays: 2 }]);
  });

  it('reports 3 hits on 1 day (gate: no)', () => {
    const result = deriveToolFailures([
      ...fail('a', '2026-11-20'),
      ...fail('b', '2026-11-20'),
      ...fail('c', '2026-11-20'),
    ]);
    expect(result.habitCounts).toEqual([{ key: 'Bash:exit-code', hits: 3, distinctDays: 1 }]);
  });

  it('reports 3 hits on 2 days (gate: yes)', () => {
    const result = deriveToolFailures([
      ...fail('a', '2026-11-20'),
      ...fail('b', '2026-11-20'),
      ...fail('c', '2026-11-21'),
    ]);
    expect(result.habitCounts).toEqual([{ key: 'Bash:exit-code', hits: 3, distinctDays: 2 }]);
    expect(result.days).toEqual([
      { day: '2026-11-20', bucket: 'habit', key: 'Bash:exit-code', calls: 2, failures: 2 },
      { day: '2026-11-21', bucket: 'habit', key: 'Bash:exit-code', calls: 1, failures: 1 },
    ]);
  });
});

describe('deriveToolFailures: failure classes', () => {
  const cases: [string, string][] = [
    ['<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>', 'edit-precondition'],
    ['<tool_use_error>File has been modified since read, either by the user or by a linter.</tool_use_error>', 'edit-precondition'],
    ['<tool_use_error>String to replace not found in file.\nString: foo</tool_use_error>', 'edit-precondition'],
    ['<tool_use_error>No changes to make: old_string and new_string are exactly the same.</tool_use_error>', 'edit-precondition'],
    ['File does not exist. Note: your current working directory is /tmp/x.', 'missing-file'],
    ["The user doesn't want to take this action right now. STOP what you are doing.", 'denied'],
    ['Permission for this command was denied.', 'denied'],
    ['<tool_use_error>InputValidationError: Edit failed due to the following issue:</tool_use_error>', 'bad-input'],
    ["This tool's input schema does not accept that field.", 'bad-input'],
    ['Command timed out after 120000ms', 'timeout'],
    ['Something nobody has seen before', 'other'],
  ];

  it.each(cases)('files %j under class %s', (text, klass) => {
    const result = deriveToolFailures(claudeCall('c1', 'Edit', text));
    expect(result.habitCounts).toEqual([{ key: `Edit:${klass}`, hits: 1, distinctDays: 1 }]);
  });
});

describe('deriveToolFailures: the hook key rule', () => {
  const cases: [string, string, string][] = [
    ['script name', 'PreToolUse:Bash hook error: ["$HOME/.claude/hooks/model-gate-git.py"]: BLOCKED git commit', 'model-gate-git'],
    ['script name beats bracket tag', 'PreToolUse:Bash hook error: ["$HOME/.claude/hooks/paper-gate.py"]: [plan-gate] BLOCKED', 'paper-gate'],
    ['bracket tag', '[commander-rule] BLOCKED: use the commander', 'commander-rule'],
    ['RPG word', 'PreToolUse:Bash hook error: RPG destructive-guard: rm -rf is not allowed', 'destructive-guard'],
    ['first 40 characters after hook error', 'PreToolUse:Bash hook error: Some unnamed hook refused the call because of reasons', 'Some unnamed hook refused the call becau'],
    ['no hook error marker', 'Hook PreToolUse:Edit denied this tool call', 'Hook PreToolUse:Edit denied this tool ca'],
    ['claude code built-in', '<tool_use_error>Blocked: this path is outside the allowed folders</tool_use_error>', 'claude-code-builtin'],
  ];

  it.each(cases)('keys a blocked call by %s', (_name, text, key) => {
    const result = deriveToolFailures(claudeCall('h1', 'Bash', text));
    expect(result.days.map((d) => [d.bucket, d.key])).toEqual([['blocked', key]]);
  });

  it('matches every blocked-call text of the spec table with BLOCKED_PATTERNS', () => {
    const texts = [
      'PreToolUse:Bash hook error: RPG destructive-guard: nope',
      '[plan-gate] BLOCKED: no plan',
      '[commander-rule] BLOCKED: no',
      'Hook PreToolUse:Edit denied',
      '<tool_use_error>Blocked: outside folders</tool_use_error>',
    ];
    expect(texts.map((t) => BLOCKED_PATTERNS.some((p) => p.test(t)))).toEqual([true, true, true, true, true]);
    expect(BLOCKED_PATTERNS.some((p) => p.test('Exit code 1'))).toBe(false);
  });
});

describe('deriveToolFailures: Codex calls', () => {
  it('counts a Codex mcpToolCall pair with status failed under a codex: key', () => {
    const started = row({
      content: JSON.stringify({
        method: 'item/started',
        params: { item: { type: 'mcpToolCall', id: 'i1', server: 'nimbalyst-trackers', tool: 'tracker_create' } },
      }),
    });
    const completed = row({
      content: JSON.stringify({
        method: 'item/completed',
        params: {
          item: {
            type: 'mcpToolCall', id: 'i1', server: 'nimbalyst-trackers', tool: 'tracker_create',
            status: 'failed', error: { message: 'schema mismatch' },
          },
        },
      }),
    });
    const result = deriveToolFailures([started, completed]);
    expect(result.habitCounts).toEqual([
      { key: 'codex:mcp__nimbalyst-trackers__tracker_create:other', hits: 1, distinctDays: 1 },
    ]);
  });
});

describe('deriveToolFailures: Codex commandExecution and prefixes', () => {
  it('counts a commandExecution with a non-zero exit code as codex:Bash:exit-code', () => {
    const rows = [
      ...codexCommand('c1', { status: 'completed', exitCode: 2, aggregatedOutput: '1 test failed' }),
      ...codexCommand('c2', { status: 'completed', exitCode: 0, aggregatedOutput: 'ok' }),
    ];
    const result = deriveToolFailures(rows);
    expect(result.days).toEqual([
      { day: '2026-11-20', bucket: 'habit', key: 'codex:Bash:exit-code', calls: 2, failures: 1 },
    ]);
  });

  it('counts a declined commandExecution as class denied', () => {
    const result = deriveToolFailures(codexCommand('c3', { status: 'declined' }));
    expect(result.habitCounts).toEqual([{ key: 'codex:Bash:denied', hits: 1, distinctDays: 1 }]);
  });

  it('keeps a Codex hook key apart from the Claude Code one with the codex: prefix', () => {
    const text = 'PreToolUse:Bash hook error: RPG destructive-guard: rm -rf is not allowed';
    const rows = [
      ...codexCommand('c4', { status: 'failed', error: { message: text } }),
      ...claudeCall('t9', 'Bash', text),
    ];
    const result = deriveToolFailures(rows);
    expect(result.days.map((d) => [d.key, d.calls, d.failures]).sort()).toEqual([
      ['codex:destructive-guard', 1, 1],
      ['destructive-guard', 1, 1],
    ]);
  });
});

describe('deriveToolFailures: samples and caps', () => {
  const sessionFail = (n: number, text: string) =>
    claudeCall(`s${n}`, 'Bash', text, true, { session_id: `sess-${n}` });

  it('keeps 3 samples for each key, the first 3 in row order', () => {
    const rows = [1, 2, 3, 4].flatMap((n) => sessionFail(n, `Exit code 1\nboom ${n}`));
    const result = deriveToolFailures(rows);
    expect(result.samples).toEqual([
      { key: 'Bash:exit-code', sessionId: 'sess-1', text: 'Exit code 1\nboom 1' },
      { key: 'Bash:exit-code', sessionId: 'sess-2', text: 'Exit code 1\nboom 2' },
      { key: 'Bash:exit-code', sessionId: 'sess-3', text: 'Exit code 1\nboom 3' },
    ]);
    expect(result.truncated).toBe(false);
  });

  it('cuts a sample text to 200 characters and sets truncated', () => {
    const result = deriveToolFailures(sessionFail(1, `Exit code 1\n${'x'.repeat(500)}`));
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0].text).toHaveLength(200);
    expect(result.samples[0].text.startsWith('Exit code 1\nxxx')).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it('returns at most 200 keys, most failures first, and sets truncated', () => {
    const names = Array.from({ length: 200 }, (_, i) => `T${String(i).padStart(3, '0')}`);
    const rows = [
      ...names.flatMap((name, i) => claudeCall(`k${i}`, name, 'Exit code 1\nx')),
      ...claudeCall('z1', 'Zed', 'Exit code 1\nx'),
      ...claudeCall('z2', 'Zed', 'Exit code 1\nx'),
    ];
    const result = deriveToolFailures(rows);
    const keys = result.habitCounts.map((h) => h.key);
    expect(keys).toHaveLength(200);
    expect(keys[0]).toBe('Zed:exit-code');
    expect(keys).not.toContain('T199:exit-code');
    expect(result.days.some((d) => d.key === 'T199:exit-code')).toBe(false);
    expect(result.samples.some((s) => s.key === 'T199:exit-code')).toBe(false);
    expect(result.truncated).toBe(true);
  });

  it('keeps 3 unmatched samples for each day, and the same failure also counts as habit other', () => {
    const at = (day: string) => ({ created_at: `${day}T10:00:00.000Z` });
    const rows = [
      ...[1, 2, 3, 4].flatMap((n) => claudeCall(`o${n}`, 'Read', `weird ${n}`, true, { ...at('2026-11-20'), session_id: `sess-${n}` })),
      ...claudeCall('o5', 'Read', 'weird 5', true, { ...at('2026-11-21'), session_id: 'sess-5' }),
    ];
    const result = deriveToolFailures(rows);
    expect(result.otherSamples).toEqual([
      { day: '2026-11-20', sessionId: 'sess-1', text: 'weird 1' },
      { day: '2026-11-20', sessionId: 'sess-2', text: 'weird 2' },
      { day: '2026-11-20', sessionId: 'sess-3', text: 'weird 3' },
      { day: '2026-11-21', sessionId: 'sess-5', text: 'weird 5' },
    ]);
    expect(result.habitCounts).toEqual([{ key: 'Read:other', hits: 5, distinctDays: 2 }]);
  });
});

describe('deriveToolFailures: bad input', () => {
  const empty = {
    days: [], habitCounts: [], brokenToolKeys: [], samples: [], otherSamples: [], truncated: false,
  };

  it('returns an empty result for no rows and never throws on bad JSON', () => {
    expect(deriveToolFailures([])).toEqual(empty);
    const bad = [
      row({ content: 'not json at all' }),
      row({ content: '{"type":"assistant","message":' }),
      row({ content: 'null' }),
      row({ content: '{"type":"user","message":{"content":"a string, not blocks"}}' }),
      row({ content: '', created_at: 'not a date' }),
    ];
    expect(deriveToolFailures(bad)).toEqual(empty);
  });
});

describe('deriveToolFailures: machine-written prompt rows', () => {
  it('skips a user-kind row that is a system reminder, even if its content holds a tool_result', () => {
    const blocked = 'PreToolUse:Bash hook error: [plan-gate] BLOCKED: plan first';
    const reminder = row({
      message_kind: 'user',
      searchable_text: '<system-reminder>Plan mode is on</system-reminder>',
      content: resultRow('r1', blocked).content,
    });
    const result = deriveToolFailures([useRow('r1', 'Bash'), reminder]);
    expect(result.days).toEqual([]);
  });
});

describe('evaluateHabitKeys', () => {
  // Activation is on 2026-11-20. The before window is 2026-11-06 to 2026-11-19.
  // The after window is 2026-11-21 to 2026-12-04.
  const ACTIVE = [{ habitKey: 'Bash:exit-code', activatedAt: '2026-11-20T12:00:00.000Z' }];
  let seq = 0;

  /** `calls` Bash calls on one day, the first `failures` of them exit-code failures. */
  function bashDay(day: string, calls: number, failures: number, extra: Partial<ToolFailureRow> = {}) {
    return Array.from({ length: calls }, (_, i) => {
      seq += 1;
      const failed = i < failures;
      return claudeCall(`v${seq}`, 'Bash', failed ? 'Exit code 1\nx' : 'ok', failed, {
        created_at: `${day}T10:00:00.000Z`,
        session_id: `sess-${day}`,
        session_created_at: `${day}T00:00:00.000Z`,
        ...extra,
      });
    }).flat();
  }

  it('says effective when the after rate is exactly half the before rate (5/20 vs 10/20)', () => {
    const rows = [...bashDay('2026-11-10', 20, 10), ...bashDay('2026-11-25', 20, 5)];
    expect(evaluateHabitKeys(rows, ACTIVE)).toEqual([
      {
        habitKey: 'Bash:exit-code',
        before: { calls: 20, failures: 10 },
        after: { calls: 20, failures: 5 },
        verdict: 'effective',
      },
    ]);
  });

  it('says ineffective when the after rate is exactly 0.9 times the before rate (9/20 vs 10/20)', () => {
    const rows = [...bashDay('2026-11-10', 20, 10), ...bashDay('2026-11-25', 20, 9)];
    expect(evaluateHabitKeys(rows, ACTIVE)[0]).toEqual({
      habitKey: 'Bash:exit-code',
      before: { calls: 20, failures: 10 },
      after: { calls: 20, failures: 9 },
      verdict: 'ineffective',
    });
  });

  it('says inconclusive between the two cut-offs (7/20 vs 10/20)', () => {
    const rows = [...bashDay('2026-11-10', 20, 10), ...bashDay('2026-11-25', 20, 7)];
    expect(evaluateHabitKeys(rows, ACTIVE)[0].verdict).toBe('inconclusive');
  });

  it.each([
    ['the before window has 19 calls', 19, 10, 20, 2],
    ['the after window has 19 calls', 20, 10, 19, 1],
    ['the before window has 4 failures', 20, 4, 20, 0],
  ])('says inconclusive when %s', (_name, beforeCalls, beforeFails, afterCalls, afterFails) => {
    const rows = [
      ...bashDay('2026-11-10', beforeCalls, beforeFails),
      ...bashDay('2026-11-25', afterCalls, afterFails),
    ];
    expect(evaluateHabitKeys(rows, ACTIVE)[0].verdict).toBe('inconclusive');
  });

  it('does not say ineffective with fewer than 3 after failures (2/20 vs 5/100)', () => {
    const rows = [...bashDay('2026-11-10', 100, 5), ...bashDay('2026-11-25', 20, 2)];
    expect(evaluateHabitKeys(rows, ACTIVE)[0]).toMatchObject({
      before: { calls: 100, failures: 5 },
      after: { calls: 20, failures: 2 },
      verdict: 'inconclusive',
    });
  });

  it('counts whole UTC days: 14 before the activation day, 14 after it, and only newer sessions after', () => {
    const rows = [
      ...bashDay('2026-11-06', 20, 10), // first before day: counted
      ...bashDay('2026-11-05', 5, 5), // one day too early: ignored
      ...bashDay('2026-11-20', 7, 7, { session_created_at: '2026-11-20T13:00:00.000Z' }), // activation day: ignored
      ...bashDay('2026-12-04', 20, 4), // last after day: counted
      ...bashDay('2026-12-05', 5, 5), // one day too late: ignored
      ...bashDay('2026-11-22', 6, 6, { session_created_at: '2026-11-19T08:00:00.000Z' }), // older session: ignored
    ];
    expect(evaluateHabitKeys(rows, ACTIVE)[0]).toEqual({
      habitKey: 'Bash:exit-code',
      before: { calls: 20, failures: 10 },
      after: { calls: 20, failures: 4 },
      verdict: 'effective',
    });
  });

  it('counts every call of the tool as calls, but only failures of the given class and tool', () => {
    const day = '2026-11-25';
    const denied = Array.from({ length: 2 }, (_, i) =>
      claudeCall(`d${i}`, 'Bash', 'Permission for this command was denied.', true, {
        created_at: `${day}T10:00:00.000Z`,
        session_id: `sess-${day}`,
        session_created_at: `${day}T00:00:00.000Z`,
      }),
    ).flat();
    const reads = Array.from({ length: 30 }, (_, i) =>
      claudeCall(`r${i}`, 'Read', 'Exit code 1\nx', true, {
        created_at: `${day}T10:00:00.000Z`,
        session_id: `sess-${day}`,
        session_created_at: `${day}T00:00:00.000Z`,
      }),
    ).flat();
    const rows = [...bashDay('2026-11-10', 20, 10), ...bashDay(day, 18, 4), ...denied, ...reads];
    expect(evaluateHabitKeys(rows, ACTIVE)[0]).toMatchObject({
      after: { calls: 20, failures: 4 },
      verdict: 'effective',
    });
  });

  it('reads a codex: habit key as the tool codex:Bash and the class exit-code', () => {
    const rows = [
      ...codexCommand('k1', { status: 'completed', exitCode: 2 }, { created_at: '2026-11-19T10:00:00.000Z' }),
      ...codexCommand('k2', { status: 'completed', exitCode: 0 }, { created_at: '2026-11-19T11:00:00.000Z' }),
    ];
    const keys = [{ habitKey: 'codex:Bash:exit-code', activatedAt: '2026-11-20T12:00:00.000Z' }];
    expect(evaluateHabitKeys(rows, keys)).toEqual([
      {
        habitKey: 'codex:Bash:exit-code',
        before: { calls: 2, failures: 1 },
        after: { calls: 0, failures: 0 },
        verdict: 'inconclusive',
      },
    ]);
  });

  it('returns one verdict for each given key, in the given order', () => {
    const keys = [...ACTIVE, { habitKey: 'Bash:denied', activatedAt: '2026-11-20T12:00:00.000Z' }];
    const verdicts = evaluateHabitKeys(bashDay('2026-11-10', 20, 10), keys);
    expect(verdicts.map((v) => [v.habitKey, v.before.failures])).toEqual([
      ['Bash:exit-code', 10],
      ['Bash:denied', 0],
    ]);
  });

  it('gives inconclusive with zero counts for an activatedAt that is not a time, and never throws', () => {
    const keys = [{ habitKey: 'Bash:exit-code', activatedAt: 'yesterday-ish' }];
    expect(evaluateHabitKeys(bashDay('2026-11-10', 20, 10), keys)).toEqual([
      {
        habitKey: 'Bash:exit-code',
        before: { calls: 0, failures: 0 },
        after: { calls: 0, failures: 0 },
        verdict: 'inconclusive',
      },
    ]);
  });
});
