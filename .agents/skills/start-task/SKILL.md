---
name: start-task
description: Start a new task in its own git work tree - derive a branch and work tree name from the task instructions, create the work tree from origin/main, then hand the task to opencode --auto in that work tree's own Orca tab. Use when the user invokes the task command (/cc-task) or explicitly asks to start a task in a new work tree.
---

Start a task in its own git work tree: deduce a name from the instructions,
create the work tree and branch from `origin/main`, then hand the task to a
fresh `opencode --auto` agent running in that work tree's own Orca tab.

**The work tree the session starts in is read-only.** This workflow always
creates a *new* work tree and runs the task there, whatever the session was
called from — the `main` work tree, or another task's work tree. Call that
starting directory `$CALLER_WT` (`git rev-parse --show-toplevel`): it is where
sibling work trees get created, never where an edit lands. On the Orca path
Phase 3 launches the agent in the new work tree and this session then stops, so
no task edit is ever written from `$CALLER_WT`.

Creating the work tree is not approval to commit or push. Follow
`.agents/rules/no-auto-commit.md` and leave the finished changes in the working
tree. Run every git command through the `git-ops` agent when the host provides
it, per `.agents/rules/git-model.md`.

## Phase 0 — Preflight

Read the instructions and resolve the paths the later phases depend on:

```bash
CALLER_WT=$(git rev-parse --show-toplevel)      # work tree this session runs in
CALLER_BRANCH=$(git symbolic-ref --short HEAD)  # its branch ("" when detached)
git worktree list --porcelain                  # existing work trees and their branches
git -C "$CALLER_WT" status --porcelain         # its state before this task
```

Keep the `git -C "$CALLER_WT" status --porcelain` output — the Definition of
done compares it against the same command to prove nothing was written to the
caller's work tree.

Then decide which path Phase 2 takes by resolving the Orca CLI:

```bash
orca status    # prints app/runtime readiness when the CLI works
```

An `orca` on `PATH` can be a stale symlink that still exits `0` while printing
`Unable to determine Orca.app path from symlink`. Treat that message as "no
CLI", and fall back to the copy inside the app bundle before concluding Orca is
unavailable:

```bash
/Applications/Orca.app/Contents/Resources/bin/orca status
```

Use whichever command answers with readiness output as `$ORCA` for the rest of
the workflow. When neither answers, take the **git fallback** in Phase 2 and say
so in the report. Orca not running yet (`appRunning: false`) is not a missing
CLI — run `orca open` and re-check.

The new work tree always branches from `origin/main`, never from
`$CALLER_BRANCH`. Uncommitted changes in `$CALLER_WT` stay there; report them,
do not carry them over. Being called from `main`, or from a work tree that is
already on a task branch, changes nothing about this workflow: still derive a
name, create a new work tree from `origin/main`, and hand the task to an agent
that works there.

Stop and ask instead of continuing when:

- the instructions are empty or too vague to name a task;
- the name derived in Phase 1 already exists as a local branch, a remote
  branch, or a directory next to the existing work trees;
- the caller wants the changes in `$CALLER_WT` or on `main` instead of in a new
  work tree — say that `/cc-task` always creates one, and ask which they want.

## Phase 1 - Derive the name

Pick a Conventional Commit `type` for the work (`feat`, `fix`, `refactor`,
`perf`, `test`, `docs`, `chore`) and build the slug from the instructions:

```
SLUG=<type>-<summary>
```

- Lowercase ASCII kebab-case, three to five words including the type, at most
  about 40 characters.
- Describe the outcome, not the process: `feat-cc-auto-plan`, not
  `feat-make-a-plan-command`.
- No dates, issue numbers, ticket ids, or filler words (`task`, `update`,
  `change`, `work`).
- The branch name is `<owner>/<SLUG>`, where `<owner>` is `git config user.name`
  (currently `yamid-granda`), matching the repository's existing
  `yamid-granda/*` branches. The work tree directory name is `<SLUG>`, matching
  how the existing work trees are named.

Report `$BRANCH` and `$WT_PATH` before creating anything.

## Phase 2 - Create the work tree

### Orca path (preferred)

When `$ORCA` resolves, let Orca create the work tree so it also appears as a
workspace tab:

```bash
"$ORCA" worktree create --name "$SLUG" --base-branch main --setup run --json
```

Read the whole `result.worktree.id` from the JSON — it is
`<repoId>::<worktreePath>`, and every later selector needs both parts. Orca
names the branch `<git-username>/<SLUG>` from its `branchPrefix` setting, which
is `git-username` here and so already matches the `<owner>/<SLUG>` rule Phase 1
derived. **Confirm it rather than assume it**: if the returned
`result.worktree.branch` is not `refs/heads/$BRANCH`, stop and report the
mismatch instead of pushing ahead.

`--setup run` executes the repo's setup hook, which here is `pnpm install`, so
the new work tree arrives with dependencies and the husky hooks already
installed — that replaces the separate install step in Phase 3.

Orca derives its own workspace directory, so `$WT_PATH` comes from the JSON
rather than from the `$CONTAINER` guess below. Stop and ask when the returned
path is `$CALLER_WT` itself, or when the derived name already exists as a
worktree.

### Git fallback

Use this only when no Orca CLI answers. Place the new work tree next to the
existing ones, in the directory that already holds the most work trees (the Orca
workspace directory), falling back to the parent of the current work tree:

```bash
CONTAINER=$(git worktree list --porcelain | sed -n 's/^worktree //p' \
  | xargs -n1 dirname | sort | uniq -c | sort -rn | head -n1 | sed 's/^ *[0-9]* //')
WT_PATH="$CONTAINER/$SLUG"
```

Then create it:

```bash
git fetch origin
git worktree add -b "$BRANCH" "$WT_PATH" origin/main
```

When there is no `origin`, branch from local `main` instead and say so.

`git worktree add -b "$BRANCH" "$WT_PATH" origin/main` leaves the new branch
tracking `origin/main`, so a bare `git push` from `$WT_PATH` would push the
task straight into `main`. Drop that tracking as soon as the work tree exists:

```bash
git -C "$WT_PATH" branch --unset-upstream
```

Orca-created branches already carry no upstream, so this step is
git-fallback-only — do not run it on the Orca path.

The branch gets its real upstream on the first `/cc-commit-and-push` or
`/cc-accept-work-tree`, which name the branch explicitly and set the upstream
with `git push -u`. Never push this branch without naming it.

Verify before moving on:

```bash
git worktree list                                   # lists the new work tree
git -C "$WT_PATH" rev-parse --abbrev-ref HEAD       # the new branch
git -C "$WT_PATH" rev-parse HEAD origin/main         # must match
```

`$WT_PATH` must be a directory of its own, never `$CALLER_WT` itself — if the
derived path resolves to the work tree the session already runs in, stop and
derive a different slug.

## Phase 3 - Hand the task to an agent in the new work tree

This is the gate between planning and executing: on the Orca path the task runs
in the new work tree's own tab, and this session stops once the prompt is
accepted. No task edit is ever written from `$CALLER_WT`.

### Orca path (preferred)

Launch `opencode --auto` in a terminal inside the new work tree, wait for its
TUI to be ready, then send it the task:

```bash
"$ORCA" terminal create --worktree "id:$WT_ID" --title "$SLUG" \
  --command "opencode --auto" --json
"$ORCA" terminal wait --terminal "$HANDLE" --for tui-idle --timeout-ms 60000 --json
"$ORCA" terminal send --terminal "$HANDLE" --text "<task brief>" --enter --json
```

Take `$HANDLE` from `result.terminal.handle`. Use `--command "opencode --auto"`
rather than `worktree create --agent opencode`: Orca only appends its
permission-bypass argument for agents it knows that flag for, and `opencode` is
not one of them, so `--agent opencode` would start plain `opencode` that then
blocks on a permission prompt.

A bare `worktree create` also opens a fallback shell in the new work tree. That
shell is harmless; close it only after `terminal list` confirms it is unused,
and never close a configured default tab.

Gate the send on readiness. `terminal wait` reports success as
`result.wait.satisfied: true`; a timeout comes back as `ok: false` with
`error.code: "timeout"` rather than a `satisfied` field, so treat anything
other than `ok: true` **and** `satisfied: true` as not ready and re-run the wait
once with a larger `--timeout-ms`. Never send into a TUI that is still starting
— the prompt is lost. If it is still not satisfied, report the handoff as not
started and do not send.

Send the task instructions as the prompt text, not inside the launch argv, so
long or multi-line instructions need no shell quoting. Include what the
receiving agent would otherwise have to rediscover: the task itself, the
`$BRANCH` it now sits on, that its work tree is already prepared, and that it
must leave the work uncommitted.

Confirm the send reports `result.send.accepted: true`. Then **stop** — report
the work tree, branch, base ref, the new terminal handle, and that this session
handed the task off rather than implementing it. Do not wait for the receiving
agent to finish, and do not go on to edit anything yourself.

### Git fallback

When no Orca CLI answered in Phase 0, this session does the work itself. Move
it into the new work tree so the task's edits and git commands land there.
OpenCode: the session-move tool with `$WT_PATH` as the directory. On a host
whose shell `cd` does not change the session's working directory, move every
path explicitly instead: pass `$WT_PATH` as the working directory of file and
shell tools, and run git as `git -C "$WT_PATH" ...`.

Then confirm the move landed before editing anything:

```bash
git rev-parse --show-toplevel     # must print $WT_PATH
```

If it still prints `$CALLER_WT`, the session did not move: fix the move, or
fall back to explicit `$WT_PATH` paths on every tool call. Do not implement in
`$CALLER_WT` and copy the files into `$WT_PATH` afterwards — that writes the
task's changes into `main` or into another task's branch.

A new work tree has no dependencies installed, so when `node_modules` is
missing at its root, run `pnpm install` there - that also installs the husky
hooks the commit rules rely on. Skip it when the work tree only needs file
changes.

## Phase 4 - Implement the task (git fallback only)

Skip this phase entirely on the Orca path — the agent launched in Phase 3 owns
the implementation there.

Before the first edit, re-run `git rev-parse --show-toplevel` and confirm it
prints `$WT_PATH`. If it does not, stop and fix that first: a task implemented
in `$CALLER_WT` pollutes `main` or another task's branch while the work tree
created for it stays empty.

Work inside `$WT_PATH` following the repository guidance, not the branch you
came from:

- read the root `AGENTS.md`, plus the scoped `AGENTS.md` of every workspace the
  task touches, and `.agents/rules/` for the policies that apply;
- keep shared UI in `components-library` (`.agents/rules/component-reuse.md`)
  and keep route definitions in each app's own router;
- add or update tests alongside behaviour changes, following the nearest
  tests' conventions;
- run the narrowest relevant checks, then broader ones when practical, and
  report anything that could not run and why.

Do not commit or push (`.agents/rules/no-auto-commit.md`) and do not touch
`$CALLER_WT`. The receiving agent leaves its work uncommitted too; that work is
landed later with `/cc-commit-and-push`, or with `/cc-accept-work-tree` to merge
it into `main` and delete the work tree.

## Definition of done

On the Orca path, check these before reporting:

```bash
"$ORCA" worktree show --worktree "id:$WT_ID" --json   # $WT_PATH on $BRANCH
"$ORCA" terminal show --terminal "$HANDLE" --json    # agent terminal, agentIdentity opencode
git -C "$CALLER_WT" status --porcelain                # same lines as Phase 0
```

The work tree itself will still be clean at this point — the receiving agent has
just been handed the task, not finished it. `agentIdentity` should read
`opencode`; if the terminal fell back to a bare shell, the launch failed and the
handoff is not started.

On the git fallback, check these instead:

```bash
git worktree list                                   # $WT_PATH on $BRANCH
git -C "$WT_PATH" rev-parse --show-toplevel         # prints $WT_PATH
git -C "$WT_PATH" status --porcelain                # holds the task's changes
git -C "$CALLER_WT" status --porcelain              # same lines as Phase 0
```

## Report

State the branch, the work tree path, the base ref it came from, the slug rule
that produced the name, and that `$CALLER_WT` was left untouched.

Then state which path ran. On the Orca path, name the new terminal handle, that
`opencode --auto` is running there with the task instructions, and that this
session stopped instead of implementing the task. On the git fallback, say the
session now works in the new work tree, what you implemented, and the checks you
ran with their results. Report any checks you could not run either way.