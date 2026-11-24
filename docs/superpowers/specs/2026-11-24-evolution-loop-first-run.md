# Evolution loop: first watched run

The checklist for the first manual run of the `evolution-pass` skill (spec unit U4). The spec is `2026-11-24-evolution-loop-design.md`, section Testing Decisions.

## Setup

`dev:user2` has its own data folder (`~/Library/Application Support/@nimbalyst/electron-user2`), so on its own it sees no tool history. The run reads a copy of the real database instead. Two apps must never open one database at the same time.

1. Quit the installed Nimbalyst, so nothing writes to its database during the copy.
2. Move the old `electron-user2/sqlite-db` folder to `~/.claude/rpg/trash/<date>/`, if it exists.
3. Copy `~/Library/Application Support/@nimbalyst/electron/sqlite-db` to `~/Library/Application Support/@nimbalyst/electron-user2/sqlite-db`.
4. Start the dev app from the build worktree: `cd packages/electron && pnpm run dev:user2`.
5. Open the Nimbalyst workspace folder (`/Volumes/josh_external/Projects/Nimbalyst`) in the dev app.
6. In a new Claude Code session, type: "Run the evolution-pass skill."
7. Watch the run to the end. Do not answer any dialog until you write it down below.

The run counts only the history up to the copy. Sessions after the copy stay in the installed app's database.

## Checks

| # | Check | Expected | Result |
|--:|:--|:--|:--|
| 1 | The memory write raises no permission prompt | The run ends with no dialog, and `MEMORY.md` holds both markers | |
| 2 | The `memory-spike learn` section survives the write | The `Memory-Spike Learned Patterns` heading and its lines are unchanged | |
| 3 | A session in a git worktree loads the lessons | The session shows the live lessons, or this row records that it does not (a known gap, see Risks) | |
| 4 | `lessons.json` holds the run's records | `filed` has one entry per item the run filed; `passSessionIds` holds the run's own session id | |
| 5 | `get_tool_failures` and the automations calls raise no permission prompt | Both calls finish with no dialog | |
| 6 | The skill is loaded | The session's skill list shows `evolution:evolution-pass` | |
| 7 | A second run files no duplicate | The tracker gains no second item for the same key | |

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
