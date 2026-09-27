---
name: cc-commit
description: Commit and push all pending changes in this repo, following this project's git/commit rules. Use when the user runs /cc-commit or explicitly asks to commit and push everything now.
---

Review the repo's current `git status` and diff (staged and unstaged), across every workspace (`api`, `components-library`, `mobile-application`, `web-application`, and the repo root).

Delegate the actual git work to the `git-ops` subagent (per `.agents/rules/git-model.md`), instructing it to:

- Follow `.agents/rules/commits.md` (Conventional Commits v1.0.0) for every commit message.
- Split unrelated pending changes into separate, logical commits rather than one big commit — mirror how this project's commit history is already organized.
- Stage files explicitly by name, never `git add -A` / `git add .`.
- Push to the current branch's upstream once committed.

This is the one explicit trigger `.agents/rules/no-auto-commit.md` allows for committing and pushing — don't run this proactively on your own, only when the user invokes it (or explicitly asks in their message to commit and push now).

Report back the resulting commit(s) and confirm the push succeeded.
