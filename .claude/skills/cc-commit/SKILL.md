---
name: cc-commit
description: Commit and push all pending changes in this repo, following this project's git/commit rules. Use when the user runs /cc-commit or explicitly asks to commit and push everything now.
---

Read and follow `.agents/skills/commit-and-push/SKILL.md` and
`.agents/rules/commits.md`.

When available, use the `git-ops` Claude subagent for the git operations. This
skill is an alias for Claude Code; the shared workflow above is authoritative.
