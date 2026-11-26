/**
 * toolFailures -- pure failure counting behind `get_tool_failures`.
 *
 * The evolution loop needs to know which tool calls failed, why, and how often.
 * This module reads raw `ai_agent_messages` rows, pairs each tool call with its
 * result, sorts every failure into one bucket (blocked call, broken tool or
 * habit), and counts per key per UTC day. The numbers that decide a lesson's
 * verdict come from here, never from a model.
 *
 * Everything is pure: rows in, counts out. The database read and the workspace
 * check live in `sessionContextServer.ts`, so this file imports no database code.
 */

import {
  extractToolNames,
  isSyntheticPrompt,
  safeJsonParse,
  type CoachingMessageRow,
} from './sessionCoachingSignals';

/**
 * Holds one `ai_agent_messages` row with the columns this module needs
 *
 * Attributes:
 *     session_id::string
 *         The session that owns the row.
 *     created_at::string
 *         When the row was written, as ISO text.
 *     session_created_at::string(optional)
 *         When the session started, as ISO text. The verdict reads it to keep only
 *         sessions that started after a lesson went live. When it is missing, the
 *         earliest row of the session stands in.
 */
export interface ToolFailureRow extends CoachingMessageRow {
  session_id: string;
  created_at: string;
  session_created_at?: string;
}

/**
 * The three places a failure can land
 *
 * A call to a tool that this setup does not offer (class `no-such-tool`) lands in
 * `habit`, never in `broken-tool`, because the agent chose the wrong tool.
 */
export type FailureBucket = 'blocked' | 'broken-tool' | 'habit';

/**
 * Holds the counts of one key on one UTC day
 *
 * Attributes:
 *     day::string
 *         The UTC day as `YYYY-MM-DD`.
 *     bucket::FailureBucket
 *         Where the failures landed.
 *     key::string
 *         The hook name, the tool name or `<tool>:<class>`.
 *     calls::number
 *         The calls of the key's tool on that day.
 *     failures::number
 *         The failed calls of the key on that day.
 */
export interface DayCount {
  day: string;
  bucket: FailureBucket;
  key: string;
  calls: number;
  failures: number;
}

/**
 * Holds what `deriveToolFailures` counts from one list of rows
 *
 * Attributes:
 *     days::DayCount[]
 *         One entry for each UTC day, bucket and key with at least one failure.
 *     habitCounts::`{ key: string; hits: number; distinctDays: number }[]`
 *         The hits and the distinct failure days of each habit key.
 *     brokenToolKeys::`{ key: string; calls: number; failures: number }[]`
 *         The tools that fail almost every call. A call to a tool this setup does
 *         not offer is a habit (class `no-such-tool`), not a broken tool.
 *     samples::`{ key: string; sessionId: string; text: string }[]`
 *         Up to 3 failure texts for each key.
 *     otherSamples::`{ day: string; sessionId: string; text: string }[]`
 *         Up to 3 failure texts for each day that no pattern matched.
 *     truncated::boolean
 *         True only when the 200-key cap dropped some keys. Cutting one sample
 *         text to 200 characters does not set it, because that loses no key.
 */
export interface ToolFailureCounts {
  days: DayCount[];
  habitCounts: { key: string; hits: number; distinctDays: number }[];
  brokenToolKeys: { key: string; calls: number; failures: number }[];
  samples: { key: string; sessionId: string; text: string }[];
  otherSamples: { day: string; sessionId: string; text: string }[];
  truncated: boolean;
}

/**
 * Lists the patterns that mark a failure as a blocked call
 *
 * A hook or Claude Code itself refused the call. The refusal is not the tool's
 * fault, so these never count as a broken tool or a habit.
 */
export const BLOCKED_PATTERNS: readonly RegExp[] = [
  /^PreToolUse:\S+ hook error:/,
  /^\[plan-gate\] BLOCKED/,
  /^\[commander-rule\] BLOCKED/,
  /^Hook PreToolUse/,
  /^<tool_use_error>Blocked:/,
];

/** One call with its result, ready to sort. */
interface PairedCall {
  sessionId: string;
  day: string;
  tool: string;
  failed: boolean;
  text: string;
  /** A class the pairing already knows and the text patterns cannot see. */
  forcedClass?: string;
}

/** Every Codex tool name, and every Codex key, starts with this. */
const CODEX_PREFIX = 'codex:';

/**
 * Reads the text of one `tool_result` content value
 *
 * Args:
 *     content::unknown
 *         The `content` of a `tool_result` block. A string (Bash, Grep, Read) or an
 *         array of `{ type, text }` items (MCP tools).
 *
 * Returns:
 *     string
 *         A string as it is. For an array, the `text` of each text item, joined
 *         with a newline; other items add nothing. An empty string for any other value.
 */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((item): item is { type: 'text'; text: string } => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n');
}

/**
 * Tells whether the pairing may read a row
 *
 * Args:
 *     r::ToolFailureRow
 *         One message row.
 *
 * Returns:
 *     boolean
 *         False for a row with `hidden` set, and for a typed-prompt row that the
 *         machine wrote (a system reminder), so a reminder is never read as a
 *         tool result.
 */
function isReadable(r: ToolFailureRow): boolean {
  if (r.hidden) return false;
  return !(r.message_kind === 'user' && isSyntheticPrompt(r.searchable_text ?? '', r.metadata));
}

/**
 * Cuts a time down to its UTC day
 *
 * Args:
 *     iso::string
 *         A time as ISO text, for example `2026-11-24T09:53:38.926Z`.
 *
 * Returns:
 *     `string | null`
 *         The day as `YYYY-MM-DD`. `null` when the text is not a time.
 */
function utcDay(iso: string): string | null {
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) ? null : time.toISOString().slice(0, 10);
}

/**
 * Lists the content blocks of a Claude Code message row
 *
 * Args:
 *     parsed::unknown
 *         The parsed `content` of a row.
 *
 * Returns:
 *     `Record<string, unknown>[]`
 *         The blocks under `message.content`. An empty list when there are none.
 */
function blocks(parsed: unknown): Record<string, unknown>[] {
  const content = (parsed as { message?: { content?: unknown } } | undefined)?.message?.content;
  return Array.isArray(content)
    ? content.filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
    : [];
}

/**
 * Pairs each Claude Code `tool_use` block with its `tool_result` block
 *
 * Args:
 *     rows::ToolFailureRow[]
 *         Message rows in ascending id order.
 *
 * Returns:
 *     PairedCall[]
 *         One entry for each call that has a result. A call with no result is left out.
 */
function pairClaudeCalls(rows: ToolFailureRow[]): PairedCall[] {
  const uses = new Map<string, { tool: string; day: string; sessionId: string }>();
  const results = new Map<string, { failed: boolean; text: string }>();
  for (const r of rows) {
    if (!isReadable(r)) continue;
    const day = utcDay(r.created_at);
    if (day === null) continue;
    for (const b of blocks(safeJsonParse(r.content))) {
      const id = typeof b.id === 'string' ? b.id : b.tool_use_id;
      if (typeof id !== 'string') continue;
      const mapKey = `${r.session_id}\u0000${id}`;
      if (b.type === 'tool_use' && typeof b.name === 'string') {
        uses.set(mapKey, { tool: b.name, day, sessionId: r.session_id });
      } else if (b.type === 'tool_result') {
        results.set(mapKey, { failed: b.is_error === true, text: resultText(b.content) });
      }
    }
  }
  const calls: PairedCall[] = [];
  for (const [mapKey, use] of uses) {
    const result = results.get(mapKey);
    if (result) calls.push({ ...use, ...result });
  }
  return calls;
}

/**
 * Pairs the calls of both sources, Claude Code and Codex
 *
 * Args:
 *     rows::ToolFailureRow[]
 *         Message rows in ascending id order.
 *
 * Returns:
 *     PairedCall[]
 *         Every call that has a result.
 */
function pairCalls(rows: ToolFailureRow[]): PairedCall[] {
  return [...pairClaudeCalls(rows), ...pairCodexCalls(rows)];
}

/**
 * Reads the outcome of one Codex `item/completed` item
 *
 * Args:
 *     item::Record<string, unknown>
 *         The `params.item` object of the completed row.
 *
 * Returns:
 *     `{ failed: boolean; text: string; forcedClass?: string }`
 *         A call failed when its status is `failed` or `declined`, or its exit
 *         code is not 0. A declined call has class `denied`. A non-zero exit
 *         code has class `exit-code`.
 */
function codexOutcome(item: Record<string, unknown>): {
  failed: boolean;
  text: string;
  forcedClass?: string;
} {
  const error = item.error as { message?: unknown } | undefined;
  const output = item.aggregated_output ?? item.aggregatedOutput;
  const text = String(error?.message ?? output ?? '');
  const exitCode = item.exit_code ?? item.exitCode;
  if (item.status === 'declined') return { failed: true, text, forcedClass: 'denied' };
  if (typeof exitCode === 'number' && exitCode !== 0) {
    return { failed: true, text, forcedClass: 'exit-code' };
  }
  return { failed: item.status === 'failed', text };
}

/**
 * Pairs each Codex `item/started` row with the `item/completed` row of the same item id
 *
 * Args:
 *     rows::ToolFailureRow[]
 *         Message rows in ascending id order.
 *
 * Returns:
 *     PairedCall[]
 *         One entry for each Codex call that has a completed row. Each tool name
 *         starts with `codex:`, so Codex and Claude Code counts never mix.
 */
function pairCodexCalls(rows: ToolFailureRow[]): PairedCall[] {
  const starts = new Map<string, { tool: string; day: string; sessionId: string }>();
  const ends = new Map<string, ReturnType<typeof codexOutcome>>();
  for (const r of rows) {
    if (!isReadable(r)) continue;
    const day = utcDay(r.created_at);
    const parsed = safeJsonParse(r.content) as { method?: unknown; params?: { item?: unknown } } | undefined;
    const item = parsed?.params?.item as Record<string, unknown> | undefined;
    if (day === null || !item || typeof item.id !== 'string') continue;
    const mapKey = `${r.session_id}\u0000${item.id}`;
    if (parsed?.method === 'item/started') {
      const [name] = extractToolNames(r);
      if (name) starts.set(mapKey, { tool: `${CODEX_PREFIX}${name}`, day, sessionId: r.session_id });
    } else if (parsed?.method === 'item/completed') {
      ends.set(mapKey, codexOutcome(item));
    }
  }
  const calls: PairedCall[] = [];
  for (const [mapKey, start] of starts) {
    const end = ends.get(mapKey);
    if (end) calls.push({ ...start, ...end });
  }
  return calls;
}

/** A bracket tag such as `[plan-gate]` at the very start of a text. */
const BRACKET_TAG_AT_START = /^\[([a-z][\w-]*)\]/i;

/**
 * Names the hook that blocked a call, from the result text
 *
 * The first rule that fits wins: Claude Code's own block; the script file name
 * in `hooks/<name>.py`; a bracket tag such as `[plan-gate]`; the word after
 * `RPG `; and last the first 40 characters after `hook error: `. A bracket tag
 * counts only at the start of the text, or at the start of what follows
 * `hook error: `. A tag that sits later in the message is part of its wording.
 * In the 40-character fallback each run of digits becomes `#`, so a number that
 * changes from call to call does not make a new key.
 *
 * Args:
 *     text::string
 *         The result text of a blocked call, with leading space removed.
 *
 * Returns:
 *     string
 *         The hook key, for example `plan-gate`.
 */
function hookKey(text: string): string {
  if (text.startsWith('<tool_use_error>Blocked:')) return 'claude-code-builtin';
  const script = /hooks\/([^/"\s]+)\.py/.exec(text);
  if (script) return script[1];
  const marker = 'hook error: ';
  const at = text.indexOf(marker);
  const afterMarker = at === -1 ? text : text.slice(at + marker.length);
  const tag = BRACKET_TAG_AT_START.exec(text) ?? BRACKET_TAG_AT_START.exec(afterMarker);
  if (tag) return tag[1];
  const rpg = /(?:^|hook error: )RPG ([\w-]+)/.exec(text);
  if (rpg) return rpg[1];
  return afterMarker.replace(/\d+/g, '#').slice(0, 40);
}

/** One failed call with the bucket and key the sorter gave it. */
interface SortedFailure {
  call: PairedCall;
  bucket: FailureBucket;
  key: string;
  /** The failure class, set for habit failures only. */
  klass?: string;
}

/**
 * Matches the text Claude Code gives when the agent calls a tool that this setup
 * does not offer, for example Grep, Glob or Monitor
 *
 * This is an agent habit, not a broken tool, so it counts as the habit class
 * `no-such-tool` and never as a broken tool.
 */
const NO_SUCH_TOOL = /^<tool_use_error>Error: No such tool available:/;

/**
 * Lists the failure classes with the pattern that picks each, in match order
 *
 * The first pattern that matches wins. `timeout` matches anywhere in the text
 * and the others match the start. A text that matches none is class `other`.
 */
const FAILURE_CLASS_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/^<tool_use_error>File has not been read yet/, 'edit-precondition'],
  [/^<tool_use_error>File has been modified since read/, 'edit-precondition'],
  [/^<tool_use_error>String to replace not found/, 'edit-precondition'],
  [/^<tool_use_error>No changes to make/, 'edit-precondition'],
  [/^File does not exist\./, 'missing-file'],
  [/^Exit code \d+/, 'exit-code'],
  [/^The user doesn't want to take this action/, 'denied'],
  [/^Permission for this command was denied/, 'denied'],
  [/^<tool_use_error>InputValidationError/, 'bad-input'],
  [/^This tool's input schema/, 'bad-input'],
  [/timed out/, 'timeout'],
  [NO_SUCH_TOOL, 'no-such-tool'],
];

/**
 * Names the failure class of one result text
 *
 * Args:
 *     text::string
 *         The result text, with leading space removed.
 *
 * Returns:
 *     string
 *         The class, for example `exit-code`. `other` when no pattern matches.
 */
function failureClass(text: string): string {
  const hit = FAILURE_CLASS_PATTERNS.find(([pattern]) => pattern.test(text));
  return hit ? hit[1] : 'other';
}

/** True when a result text matches none of `BLOCKED_PATTERNS`. */
const NOT_BLOCKED = (text: string): boolean => !BLOCKED_PATTERNS.some((p) => p.test(text));

/**
 * Finds the tools that fail 90% or more of their calls, with at least 10 calls
 *
 * A "No such tool available" failure is not counted, because it is an agent
 * habit and not a fault of the tool.
 *
 * Args:
 *     calls::PairedCall[]
 *         Every paired call. Blocked calls count as calls but not as failures.
 *
 * Returns:
 *     Set<string>
 *         The names of the broken tools.
 */
function findRateBrokenTools(calls: PairedCall[]): Set<string> {
  const totals = new Map<string, { calls: number; failures: number }>();
  for (const call of calls) {
    const entry = totals.get(call.tool) ?? { calls: 0, failures: 0 };
    entry.calls += 1;
    const text = call.text.trimStart();
    if (call.failed && NOT_BLOCKED(text) && !NO_SUCH_TOOL.test(text)) entry.failures += 1;
    totals.set(call.tool, entry);
  }
  const broken = new Set<string>();
  for (const [tool, t] of totals) {
    // failures / calls >= 0.9, written with whole numbers so no rounding enters.
    if (t.calls >= 10 && t.failures * 10 >= t.calls * 9) broken.add(tool);
  }
  return broken;
}

/**
 * Sorts each failed call into one bucket, in the order the design sets
 *
 * A "No such tool available" failure always lands in `habit` with class
 * `no-such-tool`, even when the same tool is otherwise broken.
 *
 * Args:
 *     calls::PairedCall[]
 *         Every paired call.
 *
 * Returns:
 *     SortedFailure[]
 *         One entry for each failed call, in input order.
 */
function sortFailures(calls: PairedCall[]): SortedFailure[] {
  const brokenTools = findRateBrokenTools(calls);
  const sorted: SortedFailure[] = [];
  for (const call of calls) {
    if (!call.failed) continue;
    const text = call.text.trimStart();
    if (!NOT_BLOCKED(text)) {
      const prefix = call.tool.startsWith(CODEX_PREFIX) ? CODEX_PREFIX : '';
      sorted.push({ call, bucket: 'blocked', key: `${prefix}${hookKey(text)}` });
    } else if (!NO_SUCH_TOOL.test(text) && brokenTools.has(call.tool)) {
      sorted.push({ call, bucket: 'broken-tool', key: call.tool });
    } else {
      const klass = call.forcedClass ?? failureClass(text);
      sorted.push({ call, bucket: 'habit', key: `${call.tool}:${klass}`, klass });
    }
  }
  return sorted;
}

/**
 * Counts the calls of each tool on each UTC day
 *
 * Args:
 *     calls::PairedCall[]
 *         Every paired call.
 *
 * Returns:
 *     `Map<string, number>`
 *         The count under the id `<day>\u0000<tool>`.
 */
function countCallsByDayTool(calls: PairedCall[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const call of calls) {
    const id = `${call.day}\u0000${call.tool}`;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Counts failures for each UTC day, bucket and key
 *
 * Args:
 *     calls::PairedCall[]
 *         Every paired call, failed or not. The `calls` number comes from these.
 *     sorted::SortedFailure[]
 *         The failures with their bucket and key.
 *
 * Returns:
 *     DayCount[]
 *         One entry for each day, bucket and key. `calls` is the day's calls of
 *         each tool that the key covers.
 */
function countDays(calls: PairedCall[], sorted: SortedFailure[]): DayCount[] {
  const callsByDayTool = countCallsByDayTool(calls);
  const days = new Map<string, DayCount & { tools: Set<string> }>();
  for (const { call, bucket, key } of sorted) {
    const id = `${call.day}\u0000${bucket}\u0000${key}`;
    const entry = days.get(id) ?? { day: call.day, bucket, key, calls: 0, failures: 0, tools: new Set<string>() };
    entry.failures += 1;
    if (!entry.tools.has(call.tool)) {
      entry.tools.add(call.tool);
      entry.calls += callsByDayTool.get(`${call.day}\u0000${call.tool}`) ?? 0;
    }
    days.set(id, entry);
  }
  return [...days.values()].map(({ tools: _tools, ...count }) => count);
}

/**
 * Lists the broken tools with their calls and their broken-tool failures
 *
 * Args:
 *     calls::PairedCall[]
 *         Every paired call. The `calls` number comes from these.
 *     sorted::SortedFailure[]
 *         The failures with their bucket and key.
 *
 * Returns:
 *     `{ key: string; calls: number; failures: number }[]`
 *         One entry for each tool with a broken-tool failure.
 */
function listBrokenTools(
  calls: PairedCall[],
  sorted: SortedFailure[],
): { key: string; calls: number; failures: number }[] {
  const broken = new Map<string, number>();
  for (const f of sorted) {
    if (f.bucket === 'broken-tool') broken.set(f.key, (broken.get(f.key) ?? 0) + 1);
  }
  return [...broken].map(([key, failures]) => ({
    key,
    calls: calls.filter((c) => c.tool === key).length,
    failures,
  }));
}

/**
 * Counts the hits and the distinct failure days of each habit key
 *
 * Args:
 *     sorted::SortedFailure[]
 *         The failures with their bucket and key.
 *
 * Returns:
 *     `{ key: string; hits: number; distinctDays: number }[]`
 *         One entry for each habit key, most hits first, then by key.
 */
function countHabits(
  sorted: SortedFailure[],
): { key: string; hits: number; distinctDays: number }[] {
  const habits = new Map<string, { hits: number; days: Set<string> }>();
  for (const { call, bucket, key } of sorted) {
    if (bucket !== 'habit') continue;
    const entry = habits.get(key) ?? { hits: 0, days: new Set<string>() };
    entry.hits += 1;
    entry.days.add(call.day);
    habits.set(key, entry);
  }
  return [...habits]
    .map(([key, h]) => ({ key, hits: h.hits, distinctDays: h.days.size }))
    .sort((a, b) => b.hits - a.hits || a.key.localeCompare(b.key));
}

const MAX_KEYS = 200;

/**
 * Keeps the failures of the 200 keys with the most failures
 *
 * Args:
 *     sorted::SortedFailure[]
 *         The failures with their bucket and key.
 *
 * Returns:
 *     kept::SortedFailure[]
 *         The failures of the kept keys, in input order.
 *     truncated::boolean
 *         True when some keys were dropped. Ties drop the key that sorts last.
 */
function capKeys(sorted: SortedFailure[]): { kept: SortedFailure[]; truncated: boolean } {
  const totals = new Map<string, number>();
  for (const { bucket, key } of sorted) {
    const id = `${bucket}\u0000${key}`;
    totals.set(id, (totals.get(id) ?? 0) + 1);
  }
  if (totals.size <= MAX_KEYS) return { kept: sorted, truncated: false };
  const ranked = [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const keep = new Set(ranked.slice(0, MAX_KEYS).map(([id]) => id));
  return { kept: sorted.filter((f) => keep.has(`${f.bucket}\u0000${f.key}`)), truncated: true };
}

const MAX_SAMPLES_PER_KEY = 3;
const MAX_SAMPLE_CHARS = 200;

/**
 * Keeps the first few failure texts of each key, each cut to 200 characters
 *
 * Args:
 *     sorted::SortedFailure[]
 *         The failures with their bucket and key, in row order.
 *
 * Returns:
 *     samples::`{ key: string; sessionId: string; text: string }[]`
 *         Up to 3 samples for each key.
 *
 * A text cut to 200 characters is not reported as `truncated`: no key is lost.
 */
function collectSamples(sorted: SortedFailure[]): {
  samples: { key: string; sessionId: string; text: string }[];
} {
  const perKey = new Map<string, number>();
  const samples: { key: string; sessionId: string; text: string }[] = [];
  for (const { call, key } of sorted) {
    const seen = perKey.get(key) ?? 0;
    if (seen >= MAX_SAMPLES_PER_KEY) continue;
    perKey.set(key, seen + 1);
    samples.push({ key, sessionId: call.sessionId, text: call.text.slice(0, MAX_SAMPLE_CHARS) });
  }
  return { samples };
}

/**
 * Keeps the first 3 failure texts of each UTC day that no pattern matched
 *
 * Args:
 *     sorted::SortedFailure[]
 *         The failures with their bucket and key, in row order.
 *
 * Returns:
 *     otherSamples::`{ day: string; sessionId: string; text: string }[]`
 *         Up to 3 samples for each day, each text cut to 200 characters. The cut
 *         does not set `truncated`.
 */
function collectOtherSamples(sorted: SortedFailure[]): {
  otherSamples: { day: string; sessionId: string; text: string }[];
} {
  const perDay = new Map<string, number>();
  const otherSamples: { day: string; sessionId: string; text: string }[] = [];
  for (const { call, klass } of sorted) {
    if (klass !== 'other') continue;
    const seen = perDay.get(call.day) ?? 0;
    if (seen >= MAX_SAMPLES_PER_KEY) continue;
    perDay.set(call.day, seen + 1);
    otherSamples.push({
      day: call.day,
      sessionId: call.sessionId,
      text: call.text.slice(0, MAX_SAMPLE_CHARS),
    });
  }
  return { otherSamples };
}

/**
 * Sorts every failed call into one bucket and counts it per key per UTC day
 *
 * Args:
 *     rows::ToolFailureRow[]
 *         Message rows in ascending id order. Rows with `hidden` set are skipped.
 *
 * Returns:
 *     ToolFailureCounts
 *         The daily counts, the habit counts and the broken tools. A row that is
 *         not valid JSON adds nothing, and the function never throws.
 */
export function deriveToolFailures(rows: ToolFailureRow[]): ToolFailureCounts {
  const calls = pairCalls(rows);
  const { kept: sorted, truncated: keysCut } = capKeys(sortFailures(calls));
  const { samples } = collectSamples(sorted);
  const { otherSamples } = collectOtherSamples(sorted);
  return {
    days: countDays(calls, sorted),
    habitCounts: countHabits(sorted),
    brokenToolKeys: listBrokenTools(calls, sorted),
    samples,
    otherSamples,
    truncated: keysCut,
  };
}

/**
 * Holds one habit key and the time its lesson went live
 *
 * Attributes:
 *     habitKey::string
 *         The key as `<tool>:<class>`, for example `Bash:exit-code`.
 *     activatedAt::string
 *         When the lesson went live, as ISO text.
 */
export interface HabitKeyInput {
  habitKey: string;
  activatedAt: string;
}

/** The calls of a tool and the failures of a habit key in one window. */
export interface WindowCounts {
  calls: number;
  failures: number;
}

/** The three verdicts. `effective` and `ineffective` are final verdicts. */
export type Verdict = 'effective' | 'ineffective' | 'inconclusive';

/**
 * Holds the before and after counts of one habit key and the verdict
 *
 * Attributes:
 *     habitKey::string
 *         The key as `<tool>:<class>`.
 *     before::WindowCounts
 *         The 14 whole UTC days before the day the lesson went live.
 *     after::WindowCounts
 *         The 14 whole UTC days after that day, in sessions that started later.
 *     verdict::Verdict
 *         What the two windows show.
 */
export interface HabitVerdict {
  habitKey: string;
  before: WindowCounts;
  after: WindowCounts;
  verdict: Verdict;
}

/**
 * Holds the full answer of the tool `get_tool_failures`
 *
 * Attributes:
 *     verdicts::HabitVerdict[]
 *         One verdict for each given habit key, from `evaluateHabitKeys`.
 *     callerSessionId::string
 *         The session that made the call, so the skill can record it.
 */
export type ToolFailuresResult = ToolFailureCounts & {
  verdicts: HabitVerdict[];
  callerSessionId: string;
};

const NO_CALLS: WindowCounts = { calls: 0, failures: 0 };
const WINDOW_DAYS = 14;
const MIN_CALLS = 20;
const MIN_BEFORE_FAILURES = 5;
const MIN_AFTER_FAILURES = 3;

/**
 * Moves a UTC day forward or back
 *
 * Args:
 *     day::string
 *         A day as `YYYY-MM-DD`.
 *     offset::number
 *         The days to move. A negative number moves back.
 *
 * Returns:
 *     string
 *         The new day as `YYYY-MM-DD`.
 */
function shiftDay(day: string, offset: number): string {
  const ms = Date.parse(`${day}T00:00:00.000Z`) + offset * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Decides the verdict from two windows
 *
 * The comparisons use whole numbers, so no rounding enters. `effective` means the
 * after rate is at most 0.5 times the before rate. `ineffective` means the after
 * window has 3 or more failures and its rate is at least 0.9 times the before rate.
 *
 * Args:
 *     before::WindowCounts
 *         The before window.
 *     after::WindowCounts
 *         The after window.
 *
 * Returns:
 *     Verdict
 *         `inconclusive` when either window has under 20 calls or the before
 *         window has under 5 failures, or when neither cut-off is met.
 */
function judge(before: WindowCounts, after: WindowCounts): Verdict {
  if (before.calls < MIN_CALLS || after.calls < MIN_CALLS) return 'inconclusive';
  if (before.failures < MIN_BEFORE_FAILURES) return 'inconclusive';
  if (2 * after.failures * before.calls <= before.failures * after.calls) return 'effective';
  const tenTimesAfter = 10 * after.failures * before.calls;
  if (after.failures >= MIN_AFTER_FAILURES && tenTimesAfter >= 9 * before.failures * after.calls) {
    return 'ineffective';
  }
  return 'inconclusive';
}

/**
 * Finds when each session started
 *
 * Args:
 *     rows::ToolFailureRow[]
 *         Message rows. A row's `session_created_at` is used when it is set,
 *         and its `created_at` when it is not.
 *
 * Returns:
 *     `Map<string, number>`
 *         The earliest start time of each session, in milliseconds.
 */
function sessionStartTimes(rows: ToolFailureRow[]): Map<string, number> {
  const starts = new Map<string, number>();
  for (const r of rows) {
    const ms = Date.parse(r.session_created_at ?? r.created_at);
    if (Number.isNaN(ms)) continue;
    starts.set(r.session_id, Math.min(starts.get(r.session_id) ?? ms, ms));
  }
  return starts;
}

/**
 * Counts the calls of one tool and the failures of one habit key in a window
 *
 * Args:
 *     calls::PairedCall[]
 *         Every paired call.
 *     sorted::SortedFailure[]
 *         The failures with their bucket and key.
 *     habitKey::string
 *         The key as `<tool>:<class>`. The tool is everything before the last colon.
 *     window::`{ first: string; last: string; startedAfter?: number }`
 *         The first and last UTC day, and optionally the time in milliseconds
 *         that a session must start after.
 *     starts::Map<string, number>
 *         The start time of each session.
 *
 * Returns:
 *     WindowCounts
 *         The calls of the tool and the failures of the key in the window.
 */
function countWindow(
  calls: PairedCall[],
  sorted: SortedFailure[],
  habitKey: string,
  window: { first: string; last: string; startedAfter?: number },
  starts: Map<string, number>,
): WindowCounts {
  const tool = habitKey.slice(0, habitKey.lastIndexOf(':'));
  const inWindow = (c: PairedCall): boolean =>
    c.day >= window.first &&
    c.day <= window.last &&
    (window.startedAfter === undefined ||
      (starts.get(c.sessionId) ?? Number.NEGATIVE_INFINITY) > window.startedAfter);
  return {
    calls: calls.filter((c) => c.tool === tool && inWindow(c)).length,
    failures: sorted.filter((f) => f.bucket === 'habit' && f.key === habitKey && inWindow(f.call)).length,
  };
}

/**
 * Judges each habit key from the 14 days before and after its lesson went live
 *
 * The day the lesson went live is in neither window. The after window counts only
 * sessions that started after `activatedAt`.
 *
 * Args:
 *     rows::ToolFailureRow[]
 *         Message rows that cover both windows, in ascending id order.
 *     habitKeys::HabitKeyInput[]
 *         The keys to judge, each with the time its lesson went live.
 *
 * Returns:
 *     HabitVerdict[]
 *         One verdict for each given key, in the same order.
 */
export function evaluateHabitKeys(rows: ToolFailureRow[], habitKeys: HabitKeyInput[]): HabitVerdict[] {
  const calls = pairCalls(rows);
  const sorted = sortFailures(calls);
  const starts = sessionStartTimes(rows);
  return habitKeys.map(({ habitKey, activatedAt }) => {
    const day = utcDay(activatedAt);
    if (day === null) return { habitKey, before: { ...NO_CALLS }, after: { ...NO_CALLS }, verdict: 'inconclusive' };
    const before = countWindow(
      calls, sorted, habitKey,
      { first: shiftDay(day, -WINDOW_DAYS), last: shiftDay(day, -1) },
      starts,
    );
    const after = countWindow(
      calls, sorted, habitKey,
      { first: shiftDay(day, 1), last: shiftDay(day, WINDOW_DAYS), startedAfter: Date.parse(activatedAt) },
      starts,
    );
    return { habitKey, before, after, verdict: judge(before, after) };
  });
}
