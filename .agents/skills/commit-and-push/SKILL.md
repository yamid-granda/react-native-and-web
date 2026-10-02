---
name: commit-and-push
description: Commit and push the repository's pending changes when the user explicitly requests it.
---

Only use this workflow after the user explicitly asks to commit and push, or
invokes the corresponding command. Review the full working tree, including
staged and unstaged changes, across all workspaces. Split unrelated changes
into logical commits when appropriate.

Use explicit file paths when staging, follow `.agents/rules/commits.md`, and
never bypass hooks. Push only when requested. If changes include work that
should not be committed or the requested push target is unclear, stop and ask.
Report the resulting commit(s) and push status.
