---
name: start-task
description: Start a new task in its own git work tree - derive a branch and work tree name from the task instructions, create the work tree from origin/main, then implement the task inside it. Use when the user invokes the task command (/cc-task) or explicitly asks to start a task in a new work tree.
---

Start a task in its own git work tree: deduce a name from the instructions,
create the work tree and branch from `origin/main`, then do the work inside it.

**The work tree the session starts in is read-only.** This workflow always
creates a *new* work tree and runs the task there, whatever the session was
called from — the `main` work tree, or another task's work tree. Call that
starting directory `$CALLER_WT` (`git rev-parse --show-toplevel`): it is where
sibling work trees get created, never where an edit lands. Phase 3 moves the
session into `$WT_PATH`, and no file is written before that move is confirmed.

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

Keep the `git -C "$CALLER_WT" status --porcelain` output — Phase 4 compares it
against the same command to prove nothing was written to the caller's work
tree.

The new work tree always branches from `origin/main`, never from
`$CALLER_BRANCH`. Uncommitted changes in `$CALLER_WT` stay there; report them,
do not carry them over. Being called from `main`, or from a work tree that is
already on a task branch, changes nothing about this workflow: still derive a
name, create a new work tree from `origin/main`, and move the session into it.

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

Place the new work tree next to the existing ones, in the directory that
already holds the most work trees (the Orca workspace directory), falling back
to the parent of the current work tree:

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

## Phase 3 - Move the session and prepare the work tree

This is the gate between planning and editing: no file is written until the
session is working in `$WT_PATH`.

Move this session into the new work tree so the task's edits and any git
commands land there. OpenCode: the session-move tool with `$WT_PATH` as the
directory. On a host whose shell `cd` does not change the session's working
directory, move every path explicitly instead: pass `$WT_PATH` as the working
directory of file and shell tools, and run git as `git -C "$WT_PATH" ...`.

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

## Phase 4 - Implement the task

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
`$CALLER_WT`. Land the work later with `/cc-commit-and-push`, or with
`/cc-accept-work-tree` to merge it into `main` and delete the work tree.

## Definition of done

Check these before reporting, and fix whichever fails:

```bash
git worktree list                                   # $WT_PATH on $BRANCH
git -C "$WT_PATH" rev-parse --show-toplevel         # prints $WT_PATH
git -C "$WT_PATH" status --porcelain                # holds the task's changes
git -C "$CALLER_WT" status --porcelain              # same lines as Phase 0
```

## Report

State the branch, the work tree path, the base ref it came from, the slug rule
that produced the name, that the session now works in the new work tree and
that `$CALLER_WT` was left untouched, what you implemented, the checks you ran
with their results, and any checks you could not run.