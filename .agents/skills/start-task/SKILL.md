---
name: start-task
description: Start a new task in its own git work tree - derive a branch and work tree name from the task instructions, create the work tree from origin/main, then implement the task inside it. Use when the user invokes the task command (/cc-task) or explicitly asks to start a task in a new work tree.
---

Start a task in its own git work tree: deduce a name from the instructions,
create the work tree and branch from `origin/main`, then do the work inside it.

Creating the work tree is not approval to commit or push. Follow
`.agents/rules/no-auto-commit.md` and leave the finished changes in the working
tree. Run every git command through the `git-ops` agent when the host provides
it, per `.agents/rules/git-model.md`.

## Phase 0 — Preflight

Read the instructions and resolve the paths the later phases depend on:

```bash
git worktree list --porcelain          # existing work trees and their branches
git status --porcelain                 # state of the work tree you are called from
```

The new work tree always branches from `origin/main`, never from the branch of
the work tree this session runs in. Uncommitted changes in the calling work tree
stay there; report them, do not carry them over.

Stop and ask instead of continuing when:

- the instructions are empty or too vague to name a task;
- the name derived in Phase 1 already exists as a local branch, a remote
  branch, or a directory next to the existing work trees.

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

When there is no `origin`, branch from local `main` instead and say so. Do not
push the new branch - it gets its upstream on the first `/cc-commit-and-push`
or `/cc-accept-work-tree`.

Verify before moving on:

```bash
git worktree list                                   # lists the new work tree
git -C "$WT_PATH" rev-parse --abbrev-ref HEAD       # the new branch
git -C "$WT_PATH" rev-parse HEAD origin/main         # must match
```

## Phase 3 - Move the session and prepare the work tree

Move this session into the new work tree so the task's edits and any git
commands land there. OpenCode: the session-move tool with `$WT_PATH` as the
directory; otherwise `cd "$WT_PATH"`.

A new work tree has no dependencies installed, so when `node_modules` is
missing at its root, run `pnpm install` there - that also installs the husky
hooks the commit rules rely on. Skip it when the work tree only needs file
changes.

## Phase 4 - Implement the task

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

Do not commit or push (`.agents/rules/no-auto-commit.md`) and do not touch the
calling work tree. Land the work later with `/cc-commit-and-push`, or with
`/cc-accept-work-tree` to merge it into `main` and delete the work tree.

## Report

State the branch, the work tree path, the base ref it came from, the slug rule
that produced the name, what you implemented, the checks you ran with their
results, and any checks you could not run.