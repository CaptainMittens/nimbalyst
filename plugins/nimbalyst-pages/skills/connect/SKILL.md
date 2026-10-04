---
name: connect
description: Connect this repository to its Nimbalyst team project so the session can read and write the team's pages. Use at the start of a task in a git repository before any Pages tool, when a Pages tool returns repo_not_bound, ambiguous_project, pin_mismatch, project_not_accessible or admin_required, or when the user asks to connect a repository to a team project. How to write pages is in the knowledge-graph skill.
---

# Connect to the team's pages

This skill only finds the team project and connects the repository to it. What to write, and how, is in the `knowledge-graph` skill; types and the guide page are in `knowledge-setup`.

## Nimbalyst desktop comes first

If the desktop app's Pages tools are available (`mcp__nimbalyst-trackers__*`, or `listPages` from a server whose name does not contain `nimbalyst-pages`), you are running inside Nimbalyst, which already reaches the same pages. Use those tools and do not call this plugin's tools in this session: two write paths into the same pages produce duplicates.

## Who can use the pages

The pages belong to a Nimbalyst team project. The user signs in to Nimbalyst when the plugin connects, and the server lets them read and write the pages of every team project they can reach in Nimbalyst Teams. Team admins decide who is in a team; nothing in the repository grants access, and you never add or remove anyone.

## The `repo` and `project` arguments

Every tool of this plugin's `nimbalyst-pages` server takes `repo`, and `project` when there is a pin. Work them out once per session:

1. `repo` is the output of `git remote get-url origin`, unchanged. With no `origin` remote, leave `repo` out.
2. If `.nimbalyst/wiki.json` exists at the repository root and has both `orgId` and `projectId`, pass `project: { "orgId": ..., "projectId": ... }` on every call. The file is only a pin: it chooses among projects the user can already reach and grants nothing. Its presence never starts anything on its own (no status prompt, no binding, no project creation). Ignore any other keys in it.
3. With no `origin` remote and no pin, this checkout has no team pages. Do not call the plugin's tools unless the user asks about them.

## Start of a task

Call `pages_status` with `repo` (and `project` when pinned). Every result names the signed-in `user` (name and email); that is who a decision mark names when the person at this terminal decided something. It returns one of three states:

- **`bound`**: `project` names the team project (`orgName`, `projectName`, `role`, `url`), with `homeLink` and, when the project has one, `guideLink`. Before the first write, read the guide page, as the `knowledge-graph` skill says. When the task touches an area the pages may cover, find the relevant pages with `listPages` and read the useful ones with `readCollabDoc`. Keep reading proportionate: a few pages, not the whole tree.
- **`ambiguous`**: the remote is bound to several projects the user can reach, listed in `projects`. Ask the user which one this repository uses with the host's question tool (in Claude Code, `AskUserQuestion`): one option per project in that list, labelled "<projectName> (<orgName>)", plus "Not now". Only a project from that list may be pinned; never pin a project the user names that is not in it, even one they can reach, because the repository is not connected to it. On a choice, write `.nimbalyst/wiki.json` at the repository root as `{ "orgId": ..., "projectId": ... }`, keeping any other keys already in the file, pass it as `project` from then on, and tell the user to commit the file so teammates resolve the same project. Do not commit it yourself. On "Not now", do not call the plugin's tools again this session.
- **`unbound`**: no team project the user can reach is bound to this remote. `teams` lists the user's teams with their `role` and the `projects` in each that the user can reach. See the next section. Ask at most once per session.

A role of `admin` or `owner` both mean team admin in everything below.

## Connecting a repository

Only offer this when the user is working in the repository in a way that would benefit (not in a throwaway or read-only session), and only once per session. Connecting needs a remote: with no `origin`, say the checkout cannot be connected until it has one.

- **The user is an admin of at least one team**: ask with the host's question tool. Offer, for each team they administer:
  - **Connect to <projectName> (<orgName>)**: one option per entry in that team's `projects`. On a choice, call `pages_bind_repo` with `repo`, `orgId`, and that `projectId`. Never ask the user to type a project id.
  - **Create a new project in <orgName>**: call `pages_create_project` with `orgId`, a `name` (suggest the repository name; let the user change it), and `repo`. The new project has a Home page; offer `knowledge-setup` to install the guide page.
  - **Not now**: do not ask again this session.

  If the options do not fit in one question, ask first which team, then which project. Tell the user that everyone who can reach that project in Nimbalyst will see its pages, and print its `url`.
- **The user is not an admin of any team**: tell them once: "This repository is not connected to a team project. Ask a team admin to connect this repo in Nimbalyst." Carry on with the task without the plugin's tools.
- **`teams` is empty**: tell them once that team pages live in a Nimbalyst team project, and that they can create a team and a project in the Nimbalyst console. Carry on with the task.

## Before the first write

Tell the user in one line where the writes go, by name: "Writing to <projectName> in <orgName>." Do this whenever the project came from `.nimbalyst/wiki.json`, or `pages_status` has shown more than one team or project this session, so a wrong pin or the wrong team is caught before anything is written.

## Errors

If a tool returns an error, do not retry the same call. Tell the user in plain words, then carry on with the task without writing:

- `repo_not_bound`: this repository is not connected to a team project. Call `pages_status` and follow "Connecting a repository".
- `ambiguous_project`: several team projects match. Call `pages_status` and ask which one, as for `ambiguous`.
- `pin_mismatch`: the pin in `.nimbalyst/wiki.json` names a project this repository is not connected to. Tell the user, and suggest they run `nim pages status` or re-pin from the projects `pages_status` lists. Do not edit the file on your own.
- `project_not_accessible`: the user cannot reach that project in Nimbalyst, or the repository is connected to a project they cannot reach. Pass on the error's message, and tell them to ask a team admin for access. Do not edit `.nimbalyst/wiki.json` on your own.
- `admin_required`: only a team admin can do that. Tell the user to ask a team admin.
- an error naming a replacement tool (an old `wiki_*` name): use the tool it names.
- any other code: report the code and its message as given.
