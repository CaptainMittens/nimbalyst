<!-- Approach Critique: critic=sonnet-DEGRADED (rung 4; fable rung 2 hit its usage limit, retry would fail the same way), 14 findings (2 blocker / 12 advisory), fixed=2 rebutted=0 folded=10 noted=2, 2026-11-23 -->

# Evolution loop v1: drafted approaches (critiqued)

Inputs: `2026-11-23-hermes-atlas-evolution-adaptation.md` (gap review, decisions). Nimbalyst code read at `813acfb4c`.

## Idea Brief

### Asked
- Scope v1: failure reader + sorter, and the lessons extension. The core prompt hook (`registerContextProvider`) is a later sub-project.
- Code home: fork first, then upstream PRs for the core parts.
- Success test: after 30 days, at least 5 lessons have a verdict, Edit failures drop from 9.7% to under 5%, and every hook that blocked 20+ times has a proposal in the tracker.
- Pre-mortem: left blank by the owner. The DM supplies risks below.
- Earlier decisions: core failure reader as an MCP tool; lessons delivered through a memory file first; Atlas `auto` go-live with 14-day retirement.

### Derived from repo
- Failures: Claude Code `tool_result` rows carry `is_error`; the tool name comes from the matching `tool_use` block by `tool_use_id`. Measured: 2,207 failures in 14 days; one SQL join matched every top-10 tool.
- Existing reader: `handleGetSessionCoachingSignals` (`packages/electron/src/main/mcp/sessionContextServer.ts:263`) reads `ai_agent_messages` for one session; `deriveCoachingSignals` is pure (`sessionCoachingSignals.ts:210`). It is session-scoped, not workspace-scoped.
- Extensions: a backend module has no database or transcript service (`packages/extension-sdk/src/types/backendSessions.ts:245-261` and siblings). A panel can run read-only SQL through `host.data.query` (`panel.ts:559`).
- Extensions can ship Claude plugin skills: extension plugin paths reach the SDK as `options.plugins` (`claudeCode/sdkOptionsBuilder.ts:387-391`). Example: `packages/extensions/planning/claude-plugin/`.
- Schedules: the `automations` extension runs agent prompts on a schedule.
- Delivery precedent: `memory-spike learn` writes an auto-generated section into the Claude Code auto-memory `MEMORY.md` for the workspace, and Claude Code loads that file into every session at that path.
- Owner turns: `isSyntheticPrompt` (`sessionCoachingSignals.ts:105`).
- Constraints: no new restriction without the owner's ask (`.claude/rules/no-unrequested-restrictions.md`); every runtime behavior change ships with a unit test (repo `CLAUDE.md`); static imports in the main process.

## The sorter (all approaches)

Deterministic, runs before any lesson step. One failure goes to exactly one bucket:
1. `hook-block`: the result text starts with a hook error (`PreToolUse:<Tool> hook error:`, `[plan-gate] BLOCKED`, and similar). Key: the hook's name. Output: a hook-message proposal.
2. `setup`: the tool failed on 90% or more of its calls, with at least 10 calls in the window. Key: the tool. Output: a setup proposal.
3. `agent-habit`: everything else. Key: tool + failure class (exit code, edit precondition, missing file, bad input, timeout, denied, other). Output: lesson candidate when seen 3+ times on 2+ days (Atlas rule).

## Approach 1 (recommended): core counts, agent judgment

- Core: new pure module `toolFailures.ts` beside `sessionCoachingSignals.ts`, plus a workspace-scoped MCP tool `get_tool_failures({ sinceDays, signatures? })`. It returns per-bucket, per-key, per-day `{ calls, failures }`, three sample details per key, and, when `signatures` are given, before/after failure rates around each signature's `activatedAt`. All math lives here, under unit tests.
- Extension: a small built-in extension `evolution` that ships a Claude plugin skill `evolution-pass` and registers a daily automation. The skill calls `get_tool_failures`, reads and writes a state file `nimbalyst-local/evolution/lessons.json` (lesson id, signature, text, status, activatedAt, verdict, rates), drafts lesson text for new `agent-habit` candidates, marks them live (auto mode), retires lessons whose verdict is `ineffective` after 14 days, writes the live lessons into one marked section of the workspace auto-memory `MEMORY.md` (1,400 characters at most), and files one tracker item per new `hook-block` or `setup` key.
- Core diff: one module, one MCP tool registration, tests. Extension: manifest, skill markdown, automation definition. No new SDK surface.
- Trade-off: lesson wording and file writes depend on an agent run; each daily run costs one agent session.

## Approach 2: everything in core

- Core: an `EvolutionService` in the main process owns the failure reader, sorter, lesson store (new table), verdicts, the `MEMORY.md` writer, and tracker filing, on a main-process timer. Lesson text comes from fixed templates per failure class (Atlas template path); no agent run.
- UI: a settings panel lists lessons and verdicts.
- Trade-off: deterministic and cheap per run, but the largest core diff (schema migration, service, timer, UI), the hardest upstream review, and template-only lessons are generic.

## Approach 3: TypeScript extension with a new SDK service

- Core: the failure reader plus a new backend SDK service `ctx.services.transcripts.toolFailures(...)`.
- Extension: a backend module does sorting, lessons, verdicts, file writes, and tracker filing in TypeScript; a panel shows a dashboard.
- Trade-off: clean extension boundary and testable code, but two core changes (reader and a new public SDK surface that upstream must agree to support), and still needs templates or an agent for lesson wording.

## Recommendation

Approach 1. The math that decides verdicts is deterministic and tested in core; the judgment parts (lesson wording, proposal text) are what an agent does well, and Atlas uses a model for the same job (its reflector). It needs no new public SDK surface, which keeps the upstream PR to one module and one tool.

## Critique fold (2026-11-23)

Each finding was checked against the code or the database before it was folded.

| # | Tag | Finding | Fold |
|--:|:--|:--|:--|
| 1 | blocker | No manifest field registers an automation; new automations default to `enabled: false` (`automations/src/frontmatter/types.ts:112`). | Fixed. A one-time setup step in the `evolution-pass` skill calls `automations_create` with `enabled: true` (`automations/src/index.tsx:219`). Automations run only while a Nimbalyst window is open on the workspace; that is accepted and written down. |
| 8 | blocker | The sorter puts hook blocks first, so a tool that fails only because a hook blocks it never reaches `setup`. Checked: all 31 ExitPlanMode failures that name `planFilePath` are hook blocks. | Fixed. The `setup` rule counts only failures that are not hook blocks. ExitPlanMode lands in `hook-block`, keyed by the hook. |
| 3 | advisory | A 14-day scan of `ai_agent_messages` may be slow. | Folded. The tool takes a `since` cursor and returns daily buckets, so each daily pass reads one day. The 14-day join in this session returned at once on SQLite. |
| 4, 5 | advisory | Reproducing Claude Code's memory path encoding is fragile, and worktree loading is unverified. | Folded. The pass runs inside Claude Code, which states its own memory folder in the system prompt; the skill writes there, so no path encoding is needed. The worktree case becomes a named check in the test plan. |
| 6 | advisory | A permission prompt on the memory write would hang the unattended run. | Folded. The first run is a manual run that is watched; the test plan names this check. |
| 7 | advisory | `memory-spike learn` and the pass both rewrite `MEMORY.md`. | Folded. The pass owns `evolution:lessons:start/end` markers, edits only inside them, and runs at a different hour. The test plan checks that `memory-spike learn` keeps foreign sections. |
| 9 | advisory | Two hook prefixes may not cover all hooks. | Folded. Hook detection is a regex list in one place, and the tool returns up to 3 unmatched `other` samples per day so the list can grow. |
| 10 | advisory | No minimum count for `inconclusive`; retirement and the after-window end on the same day; sessions started before activation dilute the after-window. | Folded. `inconclusive` when either window has fewer than 20 calls for the key or the before-window has fewer than 5 failures. The after-window starts the day after activation and counts only sessions created after activation. Retirement is checked on day 15. |
| 11 | advisory | The pass's own sessions feed the same counts. | Folded. Sessions owned by the evolution automation are excluded by session id. |
| 12 | advisory | The gap note said `nimbalyst-memory` facts; Approach 1 says `lessons.json`. | Folded. `lessons.json` is the single store. Memory facts are dropped (YAGNI). |
| 13 | advisory | Use `automations_create` instead of raw file writes. | Folded with #1. |
| 14 | advisory | Relation to `get_session_coaching_signals` is unstated. | Folded. The new module sits beside it and reuses its row type and `isSyntheticPrompt`; the coach can call the new tool later. |
| 2 | advisory | Plugins are skipped when `explicitOnly` is true. | Noted. That mode is a deliberate user choice; the pass then does not run, which is correct. |
| — | advisory | Running sessions keep a frozen prompt. | Noted. Covered by counting only sessions created after activation (#10). |

## DM pre-mortem (owner left it blank)

1. Lessons fill the prompt with noise and the agent ignores them; the 1,400-character cap and retirement are the guard.
2. Verdicts are wrong because failure rates swing with workload, so good lessons retire; the `inconclusive` verdict and a minimum call count are the guard.
3. The `MEMORY.md` section collides with `memory-spike learn`, which rewrites the same file; each tool must own a separately marked section.
4. Worktree sessions run at a different path and load a different `MEMORY.md`, so they miss lessons until the core prompt hook ships.
