Source read: `~/.hermes/plugins/hermes-atlas-evolution` (Atlas Evolution 0.13.0, MIT). Nimbalyst read: `nimbalyst/` at `813acfb4c` (Release v0.84.3).

# Adapting Hermes Atlas Evolution to Nimbalyst

## What Atlas Evolution does

Atlas watches one Hermes install. It logs each failed tool call as a tool name, one of 22 failure classes, and a detail. A failure that comes back 3 or more times on 2 or more days becomes a short "when X, do Y" lesson. The agent sees active lessons in a prompt section (`integration.py:1075`, 1,400 characters at most). Atlas then compares the failure rate in the 14 days before a lesson with the 14 days after. It retires a lesson that did not help. Anything bigger than a lesson goes into a proposal queue with a risk level and an exact command, and only the owner can approve it (`docs/en-US/evolution-loop.md:566-570`).

The code is 28,226 lines of Python (`wc -l`, this session). Most of it looks after Hermes itself: the doctor, gateway repair, fleet updates, its plugin catalog, and Hermes memory files. None of that applies to Nimbalyst.

## What carries over and what does not

| Atlas part | Carries over? | Nimbalyst home |
|:--|:--|:--|
| Tool-failure signals (`signals.py`, hooks at `integration.py:1054-1073`) | The idea, yes | `ai_agent_messages` already holds every tool call. `get_session_coaching_signals` reads that table but keeps only tool names and counts (`packages/electron/src/main/mcp/sessionCoachingSignals.ts:33-39`). It has no error field. |
| Lessons with a before/after check (`lessons.py`, `experience.py:63-70`) | Yes, this is the core | `nimbalyst-memory` facts store the lesson text. A small table or a JSON file in the extension holds the counts. |
| Prompt injection of lessons | Not through the extension SDK today | `registerContextProvider` only logs and does nothing (`packages/runtime/src/extensions/ExtensionLoader.ts:1026-1037`). Claude Code reads `CLAUDE.md` and memory files, and those work now. |
| Proposal queue, owner-only approval (`proposals.py`) | Yes | Tracker items (`idea` or `decision` type). The owner moves the status. Agents cannot approve, which matches Atlas. |
| Hourly autopilot (`autopilot.py`) | Yes | The `automations` extension already runs scheduled agent jobs. |
| Change experiments, 7 days before and after (`experiments.py`) | Yes | The same counts, keyed on a changed rule file, skill, or setting. |
| Self-cost meter (`selfcost.py`) | Yes | `BackendSessionsService.getUsage` (`packages/extension-sdk/src/types/backendSessions.ts:255`) covers sessions the extension owns. |
| Dashboard tab | Yes | An extension panel. |
| Guard, doctor, gateway repair, fleet update, Hermes plugin catalog, `MEMORY.md` care | No | Hermes-only upkeep. |

## Overlap with tools already on this machine

`memory-spike learn` already writes "Learned: error recovery" lines into the Claude Code memory index: a failed command and the command that worked after it. That is Atlas's lesson step without the measurement or the retirement. The Nimbalyst `nimbalyst-coach` command already reads session signals and recommends changes. An adaptation should add the two parts both tools lack: a measured verdict per lesson, and a retirement for lessons that did not help.

## Recommended shape

Build the loop, not a port. Four parts, in order:

1. Signals. Add a tool-failure extraction beside `deriveCoachingSignals`: tool name, failure class, short detail, session, time. This is a core change in `packages/electron`, because extensions cannot read transcripts. The class list can start from Atlas's 22 classes.
2. Lessons and verdicts. A new built-in extension, `evolution`, groups failures, drafts lessons, counts failures per lesson before and after, and gives each lesson a verdict of effective, ineffective, or inconclusive. Store lesson text as `nimbalyst-memory` facts so recall finds it.
3. Delivery. Until `registerContextProvider` works, write active lessons to one marked section of a memory file that Claude Code reads. Making `registerContextProvider` work for coding agents is a separate core change, and it is worth an upstream issue.
4. Proposals. Every change bigger than a lesson becomes a tracker item with evidence, risk, and the exact change. A scheduled automation runs the pass once a day.

## Gap review (2026-11-23)

All counts below come from `database_query` runs against the live Nimbalyst database in this session, over the last 14 days.

### Gap 1: reading tool failures

Verdict: closed for Claude Code, open for Codex.

- A failed Claude Code result is a `user` row with a `tool_result` block and `"is_error":true`. The tool name sits on the earlier `assistant` row's `tool_use` block. One SQL join on `tool_use_id` matches them; the top 10 tools showed no unmatched rows.
- 2,207 failed tool results in 14 days. By kind: hook block 842, command exit code 578, edit precondition 451, other 267, missing file 34, user or permission denied 20, bad tool input 13, timeout 4.
- Per tool: Bash 1,310 of 41,839 calls (3.1%), Edit 516 of 5,347 (9.7%), Write 106 of 1,576 (6.7%), Read 54 of 10,174 (0.5%). Three tools failed on every call: ExitPlanMode 50 of 50, Grep 36 of 36, memory_spike_retrieve 19 of 19.
- Codex stores `item/completed` rows with `status` and `error` (`CodexAppServerRawParser.ts:526`). Only 27 Codex tool rows exist in 14 days, so Codex can wait.
- Extensions: a backend module has no database access. A panel can run read-only SQL through `host.data.query` (`packages/extension-sdk/src/types/panel.ts:559`), with the `nimbalyst-database-read` permission and a 5-second timeout. The schema is marked unstable there.
- Owner turns: `isSyntheticPrompt` (`sessionCoachingSignals.ts:105`) already separates typed prompts from machine prompts.

### Gap 2: getting lessons into the prompt

Verdict: open. No route reaches every session today.

- `registerContextProvider` only logs (`packages/runtime/src/extensions/ExtensionLoader.ts:1026`). No doc plans it.
- Both providers build their prompt with `buildClaudeCodeSystemPrompt` (`packages/runtime/src/ai/prompt.ts:143`; Codex calls it at `codexSystemPrompt.ts:36`). Its only free-text input is `sessionDirective` (`prompt.ts:111`), and only sessions an extension creates get one.
- Claude Code reads `CLAUDE.md` and memory files through `settingSources` (`claudeCode/sdkOptionsBuilder.ts:222-278`). Writing a marked section there works today, for Claude Code only.
- The voice registry (`VoiceContextProviderRegistry.ts`) is a working model: per-provider and total character caps, a failing provider is skipped. A coding-agent copy would feed `prompt.ts` once per session and freeze, so the prompt cache holds (`ClaudeCodeProvider.ts:3649`).

### New gap: most failures are not lesson material

- Hook blocks are 842 of 2,207 (38%). The top blockers: RPG destructive-guard 304, `model-gate-git.py` 116, recursive grep 80, plan-gate 49. A lesson that repeats a hook's message adds prompt text and fixes nothing. The fix is a clearer hook message, or a hook that steers before the call.
- A tool that fails on every call (Grep, ExitPlanMode, memory_spike_retrieve) is a broken setup, not an agent habit. That belongs in the proposal queue, not in a lesson.
- So the loop needs a sorter before the lesson step: agent habit, then lesson; hook block, then hook-message proposal; always-failing tool, then setup proposal.

## Decisions (Joshua, 2026-11-23)

- Failure reader: a core tool, `deriveToolFailures`, beside the coaching signals, served as an MCP tool. Not raw SQL in an extension.
- Delivery: a marked lessons section in a memory file that Claude Code reads, first. A working `registerContextProvider` in core follows, so Codex gets lessons too.
- Go live: Atlas `auto` mode. A lesson goes live after repeat hits and retires after 14 days if failures did not drop.

## Open questions

- Does the signal step go to upstream as a pull request, or stay in the fork? It touches core code.
- Should lessons go live on their own (Atlas `auto` mode), or does each one wait as a candidate? The repo rule against unrequested restrictions (`.claude/rules/no-unrequested-restrictions.md`) means the default must not add a new approval gate unless the owner chooses one.
- Which provider comes first? Claude Code reads memory files. Codex needs its own delivery path.
