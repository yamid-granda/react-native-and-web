---
name: cc-accept-work-tree
description: Commit and push this work tree's branch, merge it into main, confirm it landed, then delete the work tree and its branch. Use when the user runs /cc-accept-work-tree or explicitly asks to land a work tree into main and delete it.
---

Read and follow `.agents/skills/accept-work-tree/SKILL.md`,
`.agents/skills/commit-and-push/SKILL.md`, and `.agents/rules/commits.md`.

Invoking this command is the explicit approval for the merge into `main`, the
push to `main`, and the deletion of this work tree and its branch. Confirm the
branch tip is on `origin/main` before removing anything.

When available, use the `git-ops` Claude subagent for the git operations. This
skill is an alias for Claude Code; the shared workflow above is authoritative.