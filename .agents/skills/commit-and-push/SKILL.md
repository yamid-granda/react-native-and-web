---
name: commit-and-push
description: Commit the repository's pending changes and push them to the current branch when the user explicitly requests it.
---

Only use this workflow after the user explicitly asks to commit and push, or
invokes the corresponding command (`/cc-commit-and-push`). Review the full
working tree, including staged and unstaged changes, across all workspaces.
Split unrelated changes into logical commits when appropriate.

Use explicit file paths when staging, follow `.agents/rules/commits.md`, and
never bypass hooks. After committing, push to the current branch, setting its
upstream when the branch has no remote tracking yet. If changes include work
that should not be committed or the current branch is not the right push target,
stop and ask. Report the resulting commit(s) and push status.
