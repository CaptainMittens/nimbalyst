/**
 * Session-context tool surface (`get_session_summary`, `get_workstream_*`,
 * `list_recent_sessions`, `schedule_wakeup`, `update_session_board`).
 *
 * MCP consolidation: these tools are served by the unified internal MCP HTTP
 * server's `/mcp/host` endpoint (`nimbalyst-host`). This module exports only the
 * tool schemas + an endpoint-agnostic dispatch fn; the standalone HTTP server it
 * used to run was retired in Phase 7.
 */

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { database } from '../database/PGLiteDatabaseWorker';
import { findSessionTreeRoot, readSessionSubtree } from '../services/sessionHierarchy';
import {
  AISessionsRepository,
  SessionFilesRepository,
} from "@nimbalyst/runtime";
import type { SessionMeta } from "@nimbalyst/runtime";
import {
  appendPendingPromptSection,
  collectPendingPromptDescriptionsFromRawRows,
} from "../services/sessionSummaryPrompt";
import {
  MAX_FILES_EDITED,
  deriveCoachingSignals,
  type CoachingMessageRow,
} from "./sessionCoachingSignals";
import {
  deriveToolFailures,
  evaluateHabitKeys,
  type HabitKeyInput,
  type ToolFailureRow,
  type ToolFailuresResult,
} from "./toolFailures";
import { toMillis } from "../utils/timestampUtils";
import {
  LIST_CITABLE_INPUTS_TOOL_NAME,
  LIST_CITABLE_INPUTS_TOOL_SCHEMA,
} from "../services/pageCitations/listCitableInputs";
import { handleListCitableInputs } from "../services/pageCitations/listCitableInputsHandler";

// ─── Utilities ──────────────────────────────────────────────────────

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Strip workspace path prefix from file paths to save context window space.
 * "/Users/person/sources/nimbalyst/packages/foo.ts" -> "packages/foo.ts"
 */
function stripWorkspacePath(filePath: string, workspacePath: string): string {
  if (workspacePath && filePath.startsWith(workspacePath)) {
    const relative = filePath.slice(workspacePath.length);
    return relative.startsWith("/") ? relative.slice(1) : relative;
  }
  return filePath;
}

// ─── Last-assistant-response aggregation ────────────────────────────

/**
 * Minimal DB surface for the assistant-response aggregator. Keeps the helper
 * testable without dragging the full PGLite/SQLite adapter into the test
 * harness.
 */
export interface MessageRowDb {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Assemble the most recent assistant response for a session.
 *
 * Chunked providers (claude-code streaming, codex `agent_message_delta`s)
 * split one assistant turn across many rows. The naive
 * `ORDER BY id DESC LIMIT 1` returns the trailing fragment of the final
 * delta, not the assembled reply. We instead take every assistant row whose
 * id is greater than the most recent user-row id, in ascending order, and
 * join their `searchable_text` values.
 *
 * Returns null when the session has no assistant content yet. Output is
 * capped at 2000 chars to match the existing tool-output contract.
 */
export async function fetchLastAssistantResponse(
  db: MessageRowDb,
  sessionId: string,
  maxLen: number = 2000,
): Promise<string | null> {
  const { rows: lastUserRows } = await db.query<{ id: number }>(
    `SELECT id FROM ai_agent_messages
     WHERE session_id = $1 AND message_kind = 'user'
     ORDER BY id DESC
     LIMIT 1`,
    [sessionId]
  );
  const lastUserId = lastUserRows.length > 0 ? lastUserRows[0].id : 0;
  const { rows: assistantRows } = await db.query<{ searchable_text: string | null }>(
    `SELECT searchable_text FROM ai_agent_messages
     WHERE session_id = $1 AND message_kind = 'assistant'
       AND searchable_text IS NOT NULL
       AND id > $2
     ORDER BY id ASC`,
    [sessionId, lastUserId]
  );
  const assembled = assistantRows
    .map((row) => row.searchable_text ?? "")
    .filter((t) => t.length > 0)
    .join("\n");
  if (assembled.length === 0) return null;
  return assembled.slice(0, maxLen);
}

// ─── Tool failures (`get_tool_failures`) ─────────────────────────────

/**
 * Holds the inputs of `get_tool_failures`
 *
 * Attributes:
 *     since::unknown
 *         An ISO time. The handler cuts it down to 00:00 UTC of its day.
 *     excludeSessionIds::unknown
 *         The sessions to leave out, as a list of ids. The skill passes its own
 *         earlier sessions here.
 *     habitKeys::unknown
 *         The habit keys to judge, each as `{ habitKey, activatedAt }`.
 *     currentSessionId::string
 *         The session that made the call. The dispatcher sets it, never the model.
 */
export interface ToolFailuresArgs {
  since?: unknown;
  excludeSessionIds?: unknown;
  habitKeys?: unknown;
  currentSessionId: string;
}

/** One joined row as the database returns it. The time columns differ by backend. */
interface ToolFailureDbRow {
  session_id: string;
  created_at: unknown;
  content: string;
  message_kind: string | null;
  hidden: unknown;
  session_created_at: unknown;
}

/**
 * Reads the workspace rows of tool calls from one UTC day on
 *
 * `= ANY($3)` leaves out the listed sessions. The SQLite translator turns it into
 * `IN (...)`, so one query text serves both backends.
 */
const TOOL_FAILURE_ROWS_SQL = `
  SELECT m.session_id, m.created_at, m.content, m.message_kind, m.hidden,
         s.created_at AS session_created_at
  FROM ai_agent_messages m JOIN ai_sessions s ON s.id = m.session_id
  WHERE s.workspace_id = $1 AND m.created_at >= $2 AND m.message_kind = 'tool'
    AND NOT (m.session_id = ANY($3))
  ORDER BY m.id ASC`;

/**
 * Turns a database time into ISO text
 *
 * Args:
 *     value::unknown
 *         A `Date` (PGLite), ISO text (SQLite) or a number of milliseconds.
 *
 * Returns:
 *     string | undefined
 *         The time as ISO text. `undefined` when the value is not a time.
 */
function toIsoText(value: unknown): string | undefined {
  const ms = toMillis(value);
  return ms === null || Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/**
 * Cuts a time down to 00:00 UTC of its day
 *
 * Args:
 *     value::unknown
 *         An ISO time as text.
 *
 * Returns:
 *     string | undefined
 *         The start of the UTC day as ISO text. `undefined` when the value is not
 *         a valid time.
 */
function startOfUtcDay(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const iso = toIsoText(Date.parse(value));
  return iso === undefined ? undefined : `${iso.slice(0, 10)}T00:00:00.000Z`;
}

/**
 * Turns one database row into the row type that `toolFailures.ts` reads
 *
 * Args:
 *     row::ToolFailureDbRow
 *         A joined row with backend-specific time and flag types.
 *
 * Returns:
 *     ToolFailureRow
 *         The row with ISO text times and a boolean `hidden`.
 */
function toToolFailureRow(row: ToolFailureDbRow): ToolFailureRow {
  return {
    session_id: row.session_id,
    created_at: toIsoText(row.created_at) ?? "",
    session_created_at: toIsoText(row.session_created_at),
    content: row.content,
    message_kind: row.message_kind,
    searchable_text: null,
    metadata: null,
    hidden: Boolean(row.hidden),
  };
}

/** The furthest back a caller can read, in days. */
const MAX_LOOKBACK_DAYS = 60;

/** The inputs of `get_tool_failures` after the checks, or the reason they failed. */
type ParsedToolFailuresArgs =
  | { since: string; habitKeys: HabitKeyInput[]; excluded: string[] }
  | { error: string };

/**
 * Checks the list of habit keys
 *
 * Args:
 *     value::unknown
 *         The `habitKeys` input. `undefined` means no keys to judge.
 *
 * Returns:
 *     `HabitKeyInput[] | undefined`
 *         The keys. `undefined` when the value is not a list of
 *         `{ habitKey, activatedAt }` with a valid ISO time.
 */
function parseHabitKeys(value: unknown): HabitKeyInput[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const keys: HabitKeyInput[] = [];
  for (const item of value) {
    const { habitKey, activatedAt } = (item ?? {}) as Record<string, unknown>;
    if (typeof habitKey !== "string" || !habitKey) return undefined;
    if (typeof activatedAt !== "string" || toIsoText(Date.parse(activatedAt)) === undefined) return undefined;
    keys.push({ habitKey, activatedAt });
  }
  return keys;
}

/**
 * Checks the inputs of `get_tool_failures`
 *
 * A `since` more than 60 days back is moved to 60 days back. The skill reads at most
 * 59 days: a lesson judged on day 45, minus the 14-day before window.
 *
 * Args:
 *     args::ToolFailuresArgs
 *         The raw inputs and the calling session.
 *
 * Returns:
 *     ParsedToolFailuresArgs
 *         The checked inputs. `excluded` holds the pass sessions and the calling
 *         session, each once. An `error` text names the first input that is wrong.
 */
function parseToolFailuresArgs(args: ToolFailuresArgs): ParsedToolFailuresArgs {
  const requested = startOfUtcDay(args.since);
  if (requested === undefined) return { error: "since must be an ISO time such as 2026-11-20T00:00:00.000Z" };
  // A since older than the limit reads from the limit, with no error.
  const earliest = startOfUtcDay(new Date(Date.now() - MAX_LOOKBACK_DAYS * 86_400_000).toISOString());
  const since = earliest !== undefined && requested < earliest ? earliest : requested;
  const exclude = args.excludeSessionIds ?? [];
  if (!Array.isArray(exclude) || exclude.some((id) => typeof id !== "string")) {
    return { error: "excludeSessionIds must be a list of session id text" };
  }
  const habitKeys = parseHabitKeys(args.habitKeys);
  if (habitKeys === undefined) {
    return { error: "habitKeys must be a list of { habitKey, activatedAt } with an ISO activatedAt" };
  }
  if (typeof args.currentSessionId !== "string" || !args.currentSessionId) {
    return { error: "currentSessionId is missing, so the calling session cannot be left out" };
  }
  return { since, habitKeys, excluded: [...new Set([...(exclude as string[]), args.currentSessionId])] };
}

/**
 * Counts the failed tool calls of one workspace from one UTC day on
 *
 * Args:
 *     db::MessageRowDb
 *         The database. A test passes a fake.
 *     workspaceId::string
 *         The workspace path. Only sessions of this workspace are read.
 *     args::ToolFailuresArgs
 *         The tool inputs and the calling session.
 *
 * Returns:
 *     `ToolFailuresResult | { error: string }`
 *         The counts, or an error text when an input is not valid. It never throws
 *         for a bad input.
 */
export async function fetchToolFailures(
  db: MessageRowDb,
  workspaceId: string,
  args: ToolFailuresArgs,
): Promise<ToolFailuresResult | { error: string }> {
  if (!workspaceId) return { error: "workspace is unknown, so no sessions can be read" };
  const parsed = parseToolFailuresArgs(args);
  if ("error" in parsed) return parsed;
  const { rows } = await db.query<ToolFailureDbRow>(TOOL_FAILURE_ROWS_SQL, [
    workspaceId,
    parsed.since,
    parsed.excluded,
  ]);
  const failureRows = rows.map(toToolFailureRow);
  return {
    ...deriveToolFailures(failureRows),
    verdicts: evaluateHabitKeys(failureRows, parsed.habitKeys),
    callerSessionId: args.currentSessionId,
  };
}

// ─── Tool handlers ──────────────────────────────────────────────────

async function handleGetSessionSummary(
  targetSessionId: string | undefined,
  currentSessionId: string,
  workspaceId: string
): Promise<string> {
  const sessionId = targetSessionId || currentSessionId;

  const session = await AISessionsRepository.get(sessionId);
  if (!session) {
    return `Error: Session ${sessionId} not found`;
  }

  // Phase 3 of canonical-transcript-deprecation: ai_transcript_events is
  // going away. The session-context MCP queries now read ai_agent_messages
  // directly via the message_kind column populated at write time.
  const { getDatabase } = await import("../database/initialize");
  const db = getDatabase();
  const { rows: userRows } = await db.query<any>(
    `SELECT searchable_text FROM ai_agent_messages
     WHERE session_id = $1 AND message_kind = 'user'
       AND searchable_text IS NOT NULL
     ORDER BY id ASC`,
    [sessionId]
  );
  const userPrompts = userRows.map((row: any) => row.searchable_text || "").filter((t: string) => t.length > 0);

  const lastResponse = await fetchLastAssistantResponse(db, sessionId);

  // Keep actionable interactive prompts at the end of every summary. Raw
  // prompt rows are filtered in SQL so large sessions do not need to load their
  // complete transcript just to find an unmatched question.
  // Synthetic terminal rows (e.g. a question superseded by a new user turn)
  // carry only the tool_use_id, so they are matched by their row type.
  const { rows: promptRows } = await db.query<{ content: string }>(
    `SELECT content FROM ai_agent_messages
     WHERE session_id = $1
       AND (hidden = FALSE OR hidden IS NULL)
       AND (
         content LIKE '%AskUserQuestion%'
         OR content LIKE '%PromptForUserInput%'
         OR content LIKE '%RequestUserInput%'
         OR content LIKE '%ToolPermission%'
         OR content LIKE '%ExitPlanMode%'
         OR content LIKE '%developer_git_commit_proposal%'
         OR content LIKE '%ask_user_question_response%'
         OR content LIKE '%request_user_input_response%'
         OR content LIKE '%permission_response%'
         OR content LIKE '%git_commit_proposal%'
         OR content LIKE '%exit_plan_mode_%'
         OR content LIKE '%nimbalyst_tool_result%'
       )
     ORDER BY id ASC`,
    [sessionId]
  );
  const pendingPrompts = collectPendingPromptDescriptionsFromRawRows(promptRows);

  let editedFiles: string[] = [];
  try {
    const fileLinks = await SessionFilesRepository.getFilesBySession(
      sessionId,
      "edited"
    );
    editedFiles = fileLinks.map((f: any) => f.filePath);
  } catch {
    // File tracking might not be available for all sessions
  }

  const lines: string[] = [];
  lines.push(
    `Session: "${session.title || "Untitled"}" (${sessionId})`
  );
  lines.push(
    `Provider: ${session.provider}${session.model ? ` | Model: ${session.model}` : ""}`
  );
  lines.push(
    `Created: ${formatDate(session.createdAt)} | Last active: ${formatDate(session.updatedAt)}`
  );

  if (session.parentSessionId) {
    const parent = await AISessionsRepository.get(session.parentSessionId);
    if (parent) {
      lines.push(`Workstream: "${parent.title || "Untitled"}"`);
    }
  }

  const metadata = session.metadata as Record<string, unknown> | undefined;
  const phase = metadata?.phase as string | undefined;
  const tags = metadata?.tags as string[] | undefined;
  if (phase) {
    lines.push(`Phase: ${phase}`);
  }
  if (tags && tags.length > 0) {
    lines.push(`Tags: ${tags.map(t => `#${t}`).join(", ")}`);
  }

  lines.push("");

  if (userPrompts.length > 0) {
    lines.push(`User prompts (${userPrompts.length} turns):`);
    for (let i = 0; i < userPrompts.length; i++) {
      const prompt = userPrompts[i];
      lines.push(`${i + 1}. "${prompt}"`);
    }
  } else {
    lines.push("No user prompts found.");
  }

  if (lastResponse) {
    lines.push("");
    lines.push("Last agent response (truncated):");
    lines.push(`"${lastResponse}"`);
  }

  if (editedFiles.length > 0) {
    lines.push("");
    lines.push(`Files edited (${editedFiles.length}):`);
    for (const file of editedFiles) {
      lines.push(`- ${stripWorkspacePath(file, workspaceId)}`);
    }
  }

  return appendPendingPromptSection(lines.join("\n"), pendingPrompts);
}

/**
 * Bounded per-session evidence for the coach command.
 *
 * Deliberately narrower than `get_session_summary`: it answers "what did this
 * session reach for, and what is it linked to", not "what happened". The
 * expensive-to-read parts of a transcript are never returned -- see the caps in
 * `sessionCoachingSignals.ts`, which exist because the coach reads up to 30
 * sessions in one pass.
 *
 * Workspace-scoped: a caller may only inspect sessions from its own workspace.
 * `get_session_summary` has no such check, but this tool is designed to be
 * called in a loop over ids the model chose, so the boundary is enforced here.
 */
async function handleGetSessionCoachingSignals(
  targetSessionId: string | undefined,
  currentSessionId: string,
  workspaceId: string,
): Promise<string> {
  const sessionId = targetSessionId || currentSessionId;

  const session = await AISessionsRepository.get(sessionId);
  if (!session) {
    return `Error: Session ${sessionId} not found`;
  }
  // `workspaceId` is the workspace path here (see stripWorkspacePath), and
  // SessionData carries it as `workspacePath`.
  if (workspaceId && session.workspacePath && session.workspacePath !== workspaceId) {
    return `Error: Session ${sessionId} belongs to a different workspace`;
  }

  const { getDatabase } = await import("../database/initialize");
  const db = getDatabase();
  const { rows } = await db.query<CoachingMessageRow>(
    `SELECT content, message_kind, searchable_text, metadata, hidden
     FROM ai_agent_messages
     WHERE session_id = $1
     ORDER BY id ASC`,
    [sessionId],
  );

  const signals = deriveCoachingSignals(rows);

  // The repository returns one row per edit, so a file edited 15 times appears
  // 15 times. `get_session_summary` shows that as-is; here it would be repeated
  // across every session in a 30-session sweep, which is exactly the context
  // flooding this tool exists to avoid. Dedupe and cap.
  let filesEdited: string[] = [];
  let filesEditedTruncated = false;
  try {
    const fileLinks = await SessionFilesRepository.getFilesBySession(sessionId, "edited");
    const unique = Array.from(
      new Set(fileLinks.map((f: any) => stripWorkspacePath(f.filePath, workspaceId))),
    );
    filesEditedTruncated = unique.length > MAX_FILES_EDITED;
    filesEdited = unique.slice(0, MAX_FILES_EDITED);
  } catch {
    // File tracking might not be available for all sessions
  }

  // Phase, tags, and tracker links live in the metadata JSONB, same as
  // get_session_summary reads them.
  const metadata = session.metadata as Record<string, unknown> | undefined;

  return JSON.stringify(
    {
      sessionId,
      title: session.title || "Untitled",
      provider: session.provider,
      model: session.model ?? null,
      phase: (metadata?.phase as string | undefined) ?? null,
      tags: (metadata?.tags as string[] | undefined) ?? [],
      workstreamId: session.parentSessionId ?? null,
      worktreeId: session.worktreeId ?? null,
      createdAt: new Date(session.createdAt).toISOString(),
      lastActiveAt: new Date(session.updatedAt).toISOString(),
      isArchived: Boolean(session.isArchived),
      linkedTrackerItemIds:
        (metadata?.linkedTrackerItemIds as string[] | undefined) ?? [],
      turnCount: signals.turnCount,
      filesEdited,
      toolUsage: signals.toolUsage,
      userPrompts: signals.userPrompts,
      truncated: signals.truncated || filesEditedTruncated,
    },
    null,
    2,
  );
}

async function handleGetWorkstreamOverview(
  workstreamId: string | undefined,
  currentSessionId: string,
  workspaceId: string
): Promise<string> {
  const parentId = await findSessionTreeRoot(database, workstreamId || currentSessionId, workspaceId);

  const parent = await AISessionsRepository.get(parentId);
  if (!parent) {
    return `Error: Workstream session ${parentId} not found`;
  }

  const rows = await readSessionSubtree(database, parentId, workspaceId);

  if (rows.length === 0) {
    return `Workstream: "${parent.title || "Untitled"}" (${parentId})\nNo child sessions found.`;
  }

  const childIds = rows.map((r: any) => r.id);
  let allFileLinks: Array<{ sessionId: string; filePath: string }> = [];
  try {
    const links = await SessionFilesRepository.getFilesBySessionMany(
      childIds,
      "edited"
    );
    allFileLinks = links.map((l) => ({
      sessionId: l.sessionId,
      filePath: l.filePath,
    }));
  } catch {
    // File tracking might not be available
  }

  const filesBySession = new Map<string, string[]>();
  for (const link of allFileLinks) {
    const existing = filesBySession.get(link.sessionId) || [];
    existing.push(link.filePath);
    filesBySession.set(link.sessionId, existing);
  }

  const lines: string[] = [];
  lines.push(
    `Workstream: "${parent.title || "Untitled"}" (${parentId})`
  );
  lines.push(`Sessions (${rows.length}):`);
  lines.push("");

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const updatedAt =
      row.updated_at instanceof Date
        ? row.updated_at.getTime()
        : new Date(row.updated_at).getTime();
    const sessionFiles = filesBySession.get(row.id) || [];
    const isCurrentSession = row.id === currentSessionId;

    lines.push(
      `${i + 1}. "${row.title || "Untitled"}" (${row.id}) - last active ${formatRelativeTime(updatedAt)}${isCurrentSession ? " [CURRENT]" : ""}`
    );

    if (sessionFiles.length > 0) {
      const shown = sessionFiles.slice(0, 3).map(f => stripWorkspacePath(f, workspaceId));
      const more = sessionFiles.length - shown.length;
      lines.push(
        `   Files: ${shown.join(", ")}${more > 0 ? ` (+${more} more)` : ""}`
      );
    }
  }

  const allUniqueFiles = new Set<string>();
  for (const link of allFileLinks) {
    allUniqueFiles.add(link.filePath);
  }

  if (allUniqueFiles.size > 0) {
    lines.push("");
    lines.push(
      `All files edited across workstream (${allUniqueFiles.size} unique):`
    );
    for (const file of allUniqueFiles) {
      lines.push(`- ${stripWorkspacePath(file, workspaceId)}`);
    }
  }

  return lines.join("\n");
}

async function handleListRecentSessions(
  query: string | undefined,
  limit: number,
  offset: number,
  workspaceId: string,
  currentSessionId: string,
  includeArchived: boolean,
  searchField: "title" | "content" | "both" = "both"
): Promise<string> {
  let sessions: SessionMeta[];

  const options = { includeArchived };
  const trimmedQuery = query?.trim() ?? "";
  if (trimmedQuery.length > 0) {
    if (searchField === "title") {
      // Title-only: list everything in the workspace, then case-insensitive
      // substring match on title. Avoids the FTS path which also matches
      // conversation content. See #83.
      const all = await AISessionsRepository.list(workspaceId, options);
      const needle = trimmedQuery.toLowerCase();
      sessions = all.filter((s) =>
        (s.title ?? "").toLowerCase().includes(needle)
      );
    } else {
      sessions = await AISessionsRepository.search(workspaceId, trimmedQuery, options);
    }
  } else {
    sessions = await AISessionsRepository.list(workspaceId, options);
  }

  const leafSessions = sessions.filter(
    (s) => s.sessionType !== "workstream"
  );
  const limited = leafSessions.slice(offset, offset + limit);

  if (limited.length === 0) {
    if (trimmedQuery.length > 0) {
      const scope = searchField === "title" ? " in titles" : "";
      return `No sessions found matching "${trimmedQuery}"${scope}`;
    }
    return "No sessions found in this workspace.";
  }

  const parentIds = new Set<string>();
  for (const s of limited) {
    if (s.parentSessionId) {
      parentIds.add(s.parentSessionId);
    }
  }

  const parentTitles = new Map<string, string>();
  if (parentIds.size > 0) {
    try {
      const parents = await AISessionsRepository.getMany(
        Array.from(parentIds)
      );
      for (const p of parents) {
        parentTitles.set(p.id, p.title || "Untitled");
      }
    } catch {
      // Continue without parent titles
    }
  }

  const sessionIds = limited.map((s) => s.id);

  // Fetch running status from database (idle, running, error, interrupted)
  let statusMap = new Map<string, string>();
  if (sessionIds.length > 0) {
    try {
      const { getDatabase } = await import("../database/initialize");
      const db = getDatabase();
      const { rows: statusRows } = await db.query<{ id: string; status: string }>(
        `SELECT id, status FROM ai_sessions WHERE id = ANY($1)`,
        [sessionIds]
      );
      for (const row of statusRows) {
        statusMap.set(row.id, row.status);
      }
    } catch {
      // Non-critical -- continue without status
    }
  }

  const lines: string[] = [];
  const matchScope =
    trimmedQuery.length > 0
      ? `matching "${trimmedQuery}"${searchField === "title" ? " in titles" : ""}`
      : "total";
  const totalLabel = matchScope;
  const offsetLabel = offset > 0 ? `, offset ${offset}` : "";
  lines.push(
    `Recent sessions (showing ${limited.length} of ${leafSessions.length} ${totalLabel}${offsetLabel}):`
  );
  lines.push("");

  for (let i = 0; i < limited.length; i++) {
    const s = limited[i];
    const isCurrentSession = s.id === currentSessionId;
    const status = statusMap.get(s.id) || "idle";

    let line = `${i + 1}. "${s.title}" (${s.id}) - ${formatRelativeTime(s.updatedAt)}`;
    if (status === "running") {
      line += " [RUNNING]";
    } else if (status === "error") {
      line += " [ERROR]";
    } else if (status === "interrupted") {
      line += " [INTERRUPTED]";
    }
    if (s.isArchived) {
      line += " [ARCHIVED]";
    }
    if (isCurrentSession) {
      line += " [CURRENT]";
    }
    lines.push(line);

    const meta: string[] = [];
    meta.push(`Provider: ${s.provider}`);
    if (s.sessionType && s.sessionType !== "session") {
      meta.push(`Type: ${s.sessionType}`);
    }
    if (s.parentSessionId) {
      const parentTitle = parentTitles.get(s.parentSessionId);
      if (parentTitle) {
        meta.push(`Workstream: "${parentTitle}"`);
      }
    }
    if (s.phase) {
      meta.push(`Phase: ${s.phase}`);
    }
    if (s.tags && s.tags.length > 0) {
      meta.push(`Tags: ${s.tags.map(t => `#${t}`).join(", ")}`);
    }
    lines.push(`   ${meta.join(" | ")}`);
  }

  return lines.join("\n");
}

async function handleGetWorkstreamEditedFiles(
  groupBySession: boolean,
  currentSessionId: string,
  workspaceId: string
): Promise<string> {
  const currentSession = await AISessionsRepository.get(currentSessionId);
  if (!currentSession) {
    return "Error: Current session not found";
  }

  const parentId = await findSessionTreeRoot(database, currentSessionId, workspaceId);
  const rows = await readSessionSubtree(database, parentId, workspaceId);

  if (rows.length === 0) {
    return "No child sessions found in this workstream.";
  }

  const childIds = rows.map((r: any) => r.id);
  const allLinks = await SessionFilesRepository.getFilesBySessionMany(
    childIds,
    "edited"
  );

  if (allLinks.length === 0) {
    return "No files have been edited across the workstream.";
  }

  if (groupBySession) {
    const titleMap = new Map<string, string>();
    for (const row of rows) {
      titleMap.set(row.id, row.title || "Untitled");
    }

    const grouped = new Map<string, string[]>();
    for (const link of allLinks) {
      const existing = grouped.get(link.sessionId) || [];
      existing.push(link.filePath);
      grouped.set(link.sessionId, existing);
    }

    const uniqueFiles = new Set(allLinks.map((l) => l.filePath));

    const lines: string[] = [];
    lines.push("Files edited across workstream by session:");
    lines.push("");

    for (const [sessionId, files] of grouped) {
      const title = titleMap.get(sessionId) || "Untitled";
      lines.push(`Session: "${title}" (${sessionId})`);
      for (const file of files) {
        lines.push(`- ${stripWorkspacePath(file, workspaceId)}`);
      }
      lines.push("");
    }

    lines.push(
      `Total: ${uniqueFiles.size} unique files across ${grouped.size} sessions`
    );
    return lines.join("\n");
  } else {
    const uniqueFiles = new Set(allLinks.map((l) => l.filePath));
    const lines: string[] = [];
    lines.push(
      `Files edited across workstream (${allLinks.length} total, ${uniqueFiles.size} unique):`
    );
    for (const file of uniqueFiles) {
      lines.push(`- ${stripWorkspacePath(file, workspaceId)}`);
    }
    return lines.join("\n");
  }
}

async function handleScheduleWakeup(args: {
  sessionId: string;
  workspaceId: string;
  delaySeconds: number;
  prompt: string;
  reason: string;
}): Promise<string> {
  const { sessionId, workspaceId, delaySeconds, prompt, reason } = args;

  const session = await AISessionsRepository.get(sessionId);
  if (!session) {
    return `Error: Session ${sessionId} not found`;
  }

  const { getSessionWakeupsStore } = await import('../services/RepositoryManager');
  const { SessionWakeupScheduler } = await import('../services/SessionWakeupScheduler');

  const id = `wakeup-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const fireAt = new Date(Date.now() + delaySeconds * 1000);

  const row = await getSessionWakeupsStore().create({
    id,
    sessionId,
    workspaceId,
    prompt,
    reason,
    fireAt,
  });

  SessionWakeupScheduler.getInstance().onCreated(row);

  // Broadcast to renderers so the UI updates immediately
  const { BrowserWindow } = await import('electron');
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('wakeup:changed', row);
    }
  }

  return JSON.stringify({
    wakeupId: row.id,
    fireAt: row.fireAt,
    fireAtIso: new Date(row.fireAt).toISOString(),
    sessionId: row.sessionId,
    reason: row.reason,
  }, null, 2);
}

// ─── MCP server creation ────────────────────────────────────────────

// ─── Shared tool surface (also folded into the unified MCP server) ──
//
// MCP consolidation Phase 5: these session-context tools are served BOTH by
// this standalone server (legacy, until Phase 7 retires the port) AND by the
// unified internal HTTP server's `/mcp/host` endpoint (`nimbalyst-host`).

/** Tool schemas exposed by the session-context surface. */
export const SESSION_CONTEXT_TOOL_SCHEMAS = [
  {
    name: "get_session_summary",
    description:
      "Get a compact summary of an AI session including its title, user prompts, last agent response, files edited, and any pending user question at the end. Use this to understand what happened in a specific session. If no sessionId is provided, summarizes the current session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description:
            "ID of the session to summarize. If omitted, summarizes the current session. Use list_recent_sessions to find session IDs.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_session_coaching_signals",
    description:
      "Get bounded, structured evidence about one AI session as JSON: turn count, the user's own prompts, normalized tool usage, files edited, linked tracker item IDs, phase, tags, and workstream. Built for auditing how a workspace uses Nimbalyst (see the /planning:nimbalyst-coach workflow) -- prefer get_session_summary when you just want to know what a session was about. Output is capped so it is safe to call across many sessions; the `truncated` flag says when a cap was hit. Only sessions in the current workspace can be inspected.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description:
            "ID of the session to inspect. If omitted, inspects the current session. Use list_recent_sessions to find session IDs.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_tool_failures",
    description:
      "Count the failed tool calls of every session in the current workspace, per UTC day, as JSON. Each failure lands in one bucket: `blocked` (a hook or Claude Code refused the call), `broken-tool` (the tool cannot run in this setup) or `habit` (the agent used the tool wrongly, keyed `<tool>:<class>`). Returns daily counts, habit hits and distinct days, up to 3 sample texts per key, and a before and after verdict for each habit key you pass. Built for the evolution-pass skill. The calling session is always left out, and `callerSessionId` names it. The `truncated` flag says when a cap was hit.",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "string",
          description:
            "ISO time. The read starts at 00:00 UTC of this day, so every window holds whole UTC days.",
        },
        habitKeys: {
          type: "array",
          description:
            "Habit keys to judge. Each gets the failure counts of the 14 days before and after its lesson went live, and a verdict.",
          items: {
            type: "object",
            properties: {
              habitKey: { type: "string", description: "The key as <tool>:<class>, for example Bash:exit-code." },
              activatedAt: { type: "string", description: "ISO time when the lesson went live." },
            },
            required: ["habitKey", "activatedAt"],
          },
        },
        excludeSessionIds: {
          type: "array",
          description:
            "Session ids to leave out, such as the earlier sessions of the evolution pass itself.",
          items: { type: "string" },
        },
      },
      required: ["since"],
    },
  },
  {
    name: "get_workstream_overview",
    description:
      "Get an overview of the current workstream (parent session with child sessions). Shows all child sessions with their titles, message counts, and files edited. Use this to understand the broader context when working in a workstream.",
    inputSchema: {
      type: "object",
      properties: {
        workstreamId: {
          type: "string",
          description:
            "ID of the workstream parent session. If omitted, uses the current session's parent workstream.",
        },
      },
      required: [],
    },
  },
  {
    name: "list_recent_sessions",
    description:
      "List recent AI sessions in the current workspace. Optionally search by title or content. Use this when the user references a previous session or asks about past work (e.g., 'implement the plan from our session about X'). By default, archived sessions are excluded -- pass includeArchived: true to search across archived sessions as well. To find a session by name when the search term appears frequently in conversations, pass searchField: 'title' to restrict matching to session titles only.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Optional search string to filter sessions by title or content.",
        },
        searchField: {
          type: "string",
          enum: ["title", "content", "both"],
          description:
            "Where to look for the query. 'title' matches only session titles (case-insensitive substring). 'content' and 'both' match titles and conversation content via full-text search. Defaults to 'both'. Ignored if query is empty.",
        },
        limit: {
          type: "number",
          description:
            "Maximum number of results (default 10, max 250).",
        },
        offset: {
          type: "number",
          description:
            "Number of sessions to skip before returning results (default 0). Use with limit for pagination.",
        },
        includeArchived: {
          type: "boolean",
          description:
            "If true, include archived sessions in the results. Defaults to false. Archived sessions are marked with [ARCHIVED] in the output.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_workstream_edited_files",
    description:
      "Get all files edited across all sessions in the current workstream. Useful for understanding the full scope of changes or preparing a commit that spans multiple sessions.",
    inputSchema: {
      type: "object",
      properties: {
        groupBySession: {
          type: "boolean",
          description:
            "If true, group files by session with titles. If false (default), return a flat deduplicated list.",
        },
      },
      required: [],
    },
  },
  {
    name: "schedule_wakeup",
    description:
      "Schedule the current session to be re-invoked with a prompt after a delay. " +
      "Persists across Nimbalyst restarts but only fires while Nimbalyst is running. " +
      "If the workspace window is closed when the wakeup fires, it waits until the workspace opens. " +
      "Replaces any existing pending wakeup for this session (one wakeup per session at a time).",
    inputSchema: {
      type: "object",
      properties: {
        delaySeconds: {
          type: "number",
          description:
            "Seconds from now until the wakeup fires. Min 60, max 604800 (7 days).",
        },
        prompt: {
          type: "string",
          description:
            "The prompt to send to the session when the wakeup fires.",
        },
        reason: {
          type: "string",
          description:
            "One short sentence explaining why this wakeup was scheduled. Shown to the user in the sessions UI.",
        },
      },
      required: ["delaySeconds", "prompt", "reason"],
    },
  },
  {
    name: "update_session_board",
    description:
      "Update a session's kanban board metadata (phase and/or tags). Phase controls which column the session appears in on the Sessions Board. Tags are free-form strings for categorization. Either field can be provided independently.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description:
            "ID of the session to update. Use list_recent_sessions to find session IDs.",
        },
        phase: {
          type: ["string", "null"],
          enum: [
            "backlog",
            "planning",
            "implementing",
            "validating",
            "complete",
            null,
          ],
          description:
            "The phase to set. Use null to remove the session from the board. Omit to leave unchanged.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            "Array of tag strings. Pass an empty array to clear tags. Omit to leave unchanged.",
        },
      },
      required: ["sessionId"],
    },
  },
  LIST_CITABLE_INPUTS_TOOL_SCHEMA,
];

/**
 * Dispatch a session-context tool call and return the MCP `{content, isError}`
 * shape. `name` may carry the `mcp__nimbalyst-session-context__` (or `-host`)
 * prefix; it is stripped. Preserves the `schedule_wakeup` /
 * `update_session_board` IPC side effects (they live in the handlers below).
 */
export async function dispatchSessionContextTool(
  name: string,
  args: Record<string, any> | undefined,
  aiSessionId: string,
  workspaceId: string,
): Promise<{ content: Array<{ type: string; text: string }>; isError: boolean }> {
  const toolName = name.replace(/^mcp__nimbalyst-[a-z-]+__/, "");

  try {
    switch (toolName) {
      case "get_session_summary": {
        const result = await handleGetSessionSummary(
          args?.sessionId as string | undefined,
          aiSessionId,
          workspaceId
        );
        return {
          content: [{ type: "text", text: result }],
          isError: result.startsWith("Error:"),
        };
      }

      case "get_session_coaching_signals": {
        const result = await handleGetSessionCoachingSignals(
          args?.sessionId as string | undefined,
          aiSessionId,
          workspaceId
        );
        return {
          content: [{ type: "text", text: result }],
          isError: result.startsWith("Error:"),
        };
      }

      case "get_tool_failures": {
        // `currentSessionId` comes last, so the model cannot override it.
        const result = await fetchToolFailures(database, workspaceId, {
          ...args,
          currentSessionId: aiSessionId,
        });
        if ("error" in result) {
          return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(result) }], isError: false };
      }

      case "get_workstream_overview": {
        const result = await handleGetWorkstreamOverview(
          args?.workstreamId as string | undefined,
          aiSessionId,
          workspaceId
        );
        return {
          content: [{ type: "text", text: result }],
          isError: result.startsWith("Error:"),
        };
      }

      case "list_recent_sessions": {
        const limit = Math.min(
          Math.max((args?.limit as number) || 10, 1),
          250
        );
        const offset = Math.max((args?.offset as number) || 0, 0);
        const includeArchived = Boolean(args?.includeArchived);
        const rawSearchField = args?.searchField as string | undefined;
        const searchField: "title" | "content" | "both" =
          rawSearchField === "title" || rawSearchField === "content"
            ? rawSearchField
            : "both";
        const result = await handleListRecentSessions(
          args?.query as string | undefined,
          limit,
          offset,
          workspaceId,
          aiSessionId,
          includeArchived,
          searchField
        );
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "get_workstream_edited_files": {
        const result = await handleGetWorkstreamEditedFiles(
          (args?.groupBySession as boolean) || false,
          aiSessionId,
          workspaceId
        );
        return {
          content: [{ type: "text", text: result }],
          isError: result.startsWith("Error:"),
        };
      }

      case "schedule_wakeup": {
        const delaySeconds = args?.delaySeconds as number | undefined;
        const prompt = args?.prompt as string | undefined;
        const reason = args?.reason as string | undefined;

        if (typeof delaySeconds !== 'number' || !Number.isFinite(delaySeconds)) {
          return {
            content: [{ type: "text", text: "Error: delaySeconds is required and must be a number" }],
            isError: true,
          };
        }
        if (delaySeconds < 60 || delaySeconds > 604800) {
          return {
            content: [{ type: "text", text: `Error: delaySeconds must be between 60 and 604800 (7 days). Got ${delaySeconds}.` }],
            isError: true,
          };
        }
        if (typeof prompt !== 'string' || prompt.trim().length === 0) {
          return {
            content: [{ type: "text", text: "Error: prompt is required and must be a non-empty string" }],
            isError: true,
          };
        }
        if (typeof reason !== 'string' || reason.trim().length === 0) {
          return {
            content: [{ type: "text", text: "Error: reason is required and must be a non-empty string" }],
            isError: true,
          };
        }

        const result = await handleScheduleWakeup({
          sessionId: aiSessionId,
          workspaceId,
          delaySeconds,
          prompt: prompt.trim(),
          reason: reason.trim(),
        });
        return {
          content: [{ type: "text", text: result }],
          isError: result.startsWith("Error:"),
        };
      }

      case LIST_CITABLE_INPUTS_TOOL_NAME: {
        const result = await handleListCitableInputs(args, aiSessionId, workspaceId);
        return { content: [{ type: "text", text: result }], isError: false };
      }

      case "update_session_board": {
        const sessionId = args?.sessionId as string;
        const phase = args?.phase as string | null | undefined;
        const tags = args?.tags as string[] | undefined;

        if (!sessionId) {
          return {
            content: [{ type: "text", text: "Error: sessionId is required" }],
            isError: true,
          };
        }

        if (phase === undefined && tags === undefined) {
          return {
            content: [{ type: "text", text: "Error: at least one of phase or tags must be provided" }],
            isError: true,
          };
        }

        const validPhases = ["backlog", "planning", "implementing", "validating", "complete"];
        if (phase !== undefined && phase !== null && !validPhases.includes(phase)) {
          return {
            content: [{ type: "text", text: `Error: Invalid phase "${phase}". Valid phases: ${validPhases.join(", ")}` }],
            isError: true,
          };
        }

        if (tags !== undefined && !Array.isArray(tags)) {
          return {
            content: [{ type: "text", text: "Error: tags must be an array of strings" }],
            isError: true,
          };
        }

        // Build metadata update with only provided fields
        const metadataUpdate: Record<string, unknown> = {};
        if (phase !== undefined) metadataUpdate.phase = phase ?? undefined;
        if (tags !== undefined) metadataUpdate.tags = tags;

        await AISessionsRepository.updateMetadata(sessionId, {
          metadata: metadataUpdate,
        });

        // Notify renderer windows so kanban board updates in real time
        const rendererUpdate: Record<string, unknown> = {};
        if (phase !== undefined) rendererUpdate.phase = phase;
        if (tags !== undefined) rendererUpdate.tags = tags;

        const { BrowserWindow } = await import("electron");
        BrowserWindow.getAllWindows().forEach((window) => {
          if (!window.isDestroyed()) {
            window.webContents.send("sessions:session-updated", sessionId, rendererUpdate);
          }
        });

        const session = await AISessionsRepository.get(sessionId);
        const title = session?.title || sessionId;
        const parts: string[] = [];
        if (phase !== undefined) {
          parts.push(phase ? `phase="${phase}"` : "removed from board");
        }
        if (tags !== undefined) {
          parts.push(tags.length > 0 ? `tags=[${tags.join(", ")}]` : "tags cleared");
        }
        return {
          content: [{ type: "text", text: `Updated "${title}": ${parts.join(", ")}` }],
          isError: false,
        };
      }

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  } catch (error) {
    if (error instanceof McpError) throw error;
    console.error(`[Session Context MCP] Tool ${toolName} failed:`, error);
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
}
