---
name: accept-work-tree
description: Commit and push the current work tree's branch, merge it into main, confirm it landed on main, then remove the work tree and its branch. Use when the user invokes the accept-work-tree command or explicitly asks to land a work tree into main and delete it.
---

Accept the current work tree into `main`: commit and push its branch, merge it
into `main`, confirm the merge is on `origin/main`, then delete the work tree
and the branch that belongs to it.

Invoking this command is the explicit approval for every step it documents,
including the push to `main` and the deletion of the work tree and its branch.
Anything beyond those steps — extra branches, `--force`, history rewrites,
cleanup of unrelated work — still needs a separate, explicit ask.

Use the `git-ops` agent when the host provides it; otherwise run git commands
directly. Never bypass hooks, and follow `.agents/rules/commits.md`,
`.agents/rules/git-model.md`, and `.agents/rules/no-auto-commit.md`.

## Phase 0 — Preflight

Resolve the three paths first; every later command depends on them.

```bash
WT=$(git rev-parse --show-toplevel)      # work tree being accepted
BRANCH=$(git symbolic-ref --short HEAD) # branch checked out in it
TIP=$(git rev-parse HEAD)               # tip to confirm later
```

```bash
git worktree list --porcelain
```

The main work tree is the entry whose `branch` is `refs/heads/main`; call its
path `MAIN_WT`. Run the merge with `git -C "$MAIN_WT" ...` — `main` cannot be
checked out in two work trees, and the current directory is about to be deleted.

Stop and ask instead of continuing when:

- the current work tree *is* the main work tree, or `refs/heads/main` is not
  checked out anywhere (nothing to merge into);
- the work tree is detached (`HEAD` has no branch);
- `$MAIN_WT` has uncommitted or staged changes that the merge could touch;
- `$BRANCH` is also checked out in another work tree.

Report the resolved `$WT`, `$BRANCH`, and `$MAIN_WT` before changing anything.

## Phase 1 — Commit and push the branch

Follow `.agents/skills/commit-and-push/SKILL.md`: review the full working tree
across all workspaces, stage specific paths, split unrelated changes into
logical commits, use Conventional Commit messages.

Then push the branch and set its upstream:

```bash
git push -u origin "$BRANCH"
```

Verify the tree is clean and the push landed before merging:

```bash
git status --porcelain          # must print nothing
git rev-parse HEAD @{u}        # must print the same SHA twice
```

If there was nothing to commit, skip the commit and say so; the push and merge
still apply.

## Phase 2 — Merge into `main`

From the main work tree only:

```bash
git -C "$MAIN_WT" fetch origin
git -C "$MAIN_WT" merge --ff-only origin/main   # only if main is behind
git -C "$MAIN_WT" merge --no-ff "$BRANCH" -m "chore(<scope>): merge $BRANCH into main"
git -C "$MAIN_WT" push origin main
```

`--no-ff` matches the repo's merge history (`chore(agents): merge
yamid-granda/tetra into main`). Pick `<scope>` from the merged work — the scope
that matches the commits; use `chore(repo)` when the work spans the repository.
The `commit-msg` hook runs commitlint on merge commits too, so the message must
be Conventional Commits.

If `origin/main` has moved such that main cannot fast-forward, or the merge
conflicts, stop and ask. Do not resolve conflicts by discarding anyone's work.

## Phase 3 — Confirm before deleting anything

The work tree and branch are only removed once `main` really contains the
work. Verify, then report the result:

```bash
git -C "$MAIN_WT" fetch origin main
git -C "$MAIN_WT" merge-base --is-ancestor "$TIP" origin/main && echo confirmed
git -C "$MAIN_WT" log --oneline origin/main.."$BRANCH"   # must be empty
git -C "$MAIN_WT" log --oneline -1 origin/main
```

`git merge-base --is-ancestor` exiting `0` is the confirmation that every commit
from `$TIP` is on `origin/main`; a non-empty `origin/main..$BRANCH` means
commits are still unmerged.

If the check fails, **stop**. Leave the work tree and branch untouched and
report what is missing.

## Phase 4 — Remove the work tree and its branch

Only now, and in this order — a branch cannot be deleted while a work tree has
it checked out.

```bash
git worktree remove "$WT"     # no --force; requires a clean work tree
git worktree prune
git branch -d "$BRANCH"      # safe delete: refuses while unmerged
git push origin --delete "$BRANCH"
```

Skip the remote delete when `refs/remotes/origin/$BRANCH` does not exist.

Report the commands you did not need to run, and leave alone:

- other local or remote branches pointing at `$TIP` — a sibling work tree branch
  can share the same tip. List them and delete only on explicit request;
- branches checked out in other work trees (git refuses to delete these);
- anything outside `$WT`.

If `git worktree remove` fails because the work tree still holds modified or
untracked files, report the paths and ask before retrying with `--force`.

If the session's working directory was `$WT`, move it to `$MAIN_WT` before
finishing (OpenCode: the session-move tool; otherwise `cd "$MAIN_WT"`), since
the old directory no longer exists.

## Report

State the commits merged, the merge commit SHA, the push status, the Phase 3
confirmation result, and exactly what was removed (work tree path, local branch,
remote branch). Call out anything deliberately left in place.