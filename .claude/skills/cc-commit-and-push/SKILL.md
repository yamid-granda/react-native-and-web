---
name: cc-commit-and-push
description: Commit all pending changes in this repo and push them to the current branch, following this project's git/commit rules. Use when the user runs /cc-commit-and-push or explicitly asks to commit and push everything now.
---

Read and follow `.agents/skills/commit-and-push/SKILL.md`,
`.agents/rules/commits.md`, and `.agents/rules/git-model.md`.

Route every git command through the `git-ops` subagent, which is where all git
operations in this repository run. This skill is an alias for Claude Code; the
shared workflow above is authoritative.
