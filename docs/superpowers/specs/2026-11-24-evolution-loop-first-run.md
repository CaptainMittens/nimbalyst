# Evolution loop: first watched run

The checklist for the first manual run of the `evolution-pass` skill (spec unit U4). The spec is `2026-11-24-evolution-loop-design.md`, section Testing Decisions.

## Setup

`dev:user2` has its own data folder (`~/Library/Application Support/@nimbalyst/electron-user2`), so on its own it sees no tool history. The run reads a copy of the real database instead. Two apps must never open one database at the same time.

1. Quit the installed Nimbalyst, so nothing writes to its database during the copy.
2. Move the old `electron-user2/sqlite-db` folder to `~/.claude/rpg/trash/<date>/`, if it exists.
3. Copy `~/Library/Application Support/@nimbalyst/electron/sqlite-db` to `~/Library/Application Support/@nimbalyst/electron-user2/sqlite-db`.
4. Copy `nimbalyst-local/evolution/lessons.json` (if it exists) and the Claude Code `MEMORY.md` of this workspace to `~/.claude/rpg/trash/<date>/first-run-backup/`. The run writes both real files, but it files its tracker items only in the database copy (see "After the run").
5. Optional: add one lesson to `lessons.json` with `activatedAt` 16 days ago, `habitKey` `Bash:exit-code`, status `live` and `verdict: null`, so the judging step runs too.
6. Start the dev app from the build worktree: `cd packages/electron && pnpm run dev:user2`.
7. Open the Nimbalyst workspace folder (`/Volumes/josh_external/Projects/Nimbalyst`) in the dev app.
8. In a new Claude Code session, type: "Run the evolution-pass skill."
9. Watch the run to the end. Do not answer any dialog until you write it down below.

The run counts only the history up to the copy. Sessions after the copy stay in the installed app's database.

## After the run

Score the checks first. Then put the real files back, or the next real pass sees `filed` entries for tracker items that exist only in the copy, and never files them in the real tracker.

1. Move the run's `lessons.json` and `MEMORY.md` to `~/.claude/rpg/trash/<date>/first-run-output/`.
2. Copy the two files from `first-run-backup/` back to their places. If no `lessons.json` existed before, leave none.
3. Quit the dev app, then start the installed Nimbalyst again.

## Checks

| # | Check | Expected | Result |
|--:|:--|:--|:--|
| 1 | The memory write raises no permission prompt | The run ends with no dialog, and `MEMORY.md` holds both markers | Pass (2026-11-25). No dialog; 2 markers; 1 lesson line. |
| 2 | The `memory-spike learn` section survives the write | The `Memory-Spike Learned Patterns` heading and its lines are unchanged | Pass. A diff shows only 4 added lines, before the heading. |
| 3 | A session in a git worktree loads the lessons | The session shows the live lessons, or this row records that it does not (a known gap, see Risks) | Does not load (known gap). Claude Code gives each worktree folder its own memory folder: 8 Nimbalyst-Plugins worktrees each have one under `~/.claude/projects/`. A worktree session reads its own `MEMORY.md`, not this one. |
| 4 | `lessons.json` holds the run's records | `filed` has one entry per item the run filed; `passSessionIds` holds the run's own session id | Pass. 4 items filed, 4 `filed` entries, 1 pass id. |
| 5 | `get_tool_failures` and the automations calls raise no permission prompt | Both calls finish with no dialog | Pass. `automations_list`, `automations_create` and `get_tool_failures` ran with no dialog. |
| 6 | The skill is loaded | The session's skill list shows `evolution:evolution-pass` | Pass, in the installed fork build 0.84.4. |
| 7 | A second run files no duplicate | The tracker gains no second item for the same key | Waits for the 06:00 automation run. |

First run, 2026-11-25, in the installed fork build, on the real database (the database copy was not needed):

- The read covered 14 days, `truncated: false`.
- Filed 4 items: "Clarify block message" for the recursive-grep block (20 failures), and "Fix tool setup" for Grep (12 of 12), Monitor (1 of 15) and Glob (1 of 1).
- 1 lesson went live (`Bash:exit-code`, 17 hits on 4 days). Nothing was old enough to judge.
- Each `tracker_create` reported that the body was not stored in collaborative content. The local body was saved. This workspace has no team.
- New gap: the pass ran inside a long working session. That session is now in `passSessionIds`, so its own tool failures are never counted. Run the pass in a new session.

## Commands

Run these from the workspace folder after the run.

```bash
rg -l "evolution-pass" nimbalyst-local/automations
jq '.cursor' nimbalyst-local/evolution/lessons.json
jq '.passSessionIds | length' nimbalyst-local/evolution/lessons.json
rg -c "evolution:lessons:(start|end)" ~/.claude/projects/-Volumes-josh-external-Projects-Nimbalyst/memory/MEMORY.md
rg -n "Memory-Spike Learned Patterns" ~/.claude/projects/-Volumes-josh-external-Projects-Nimbalyst/memory/MEMORY.md
```

Expected results, in order:

- 1 file.
- A date.
- `1`.
- `2`.
- 1 line.

For a session in the `nimbalyst/` repo folder, the memory folder name differs. Record which file the run named.
