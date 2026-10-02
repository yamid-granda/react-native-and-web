---
description: Commit and push pending changes using this repository's git workflow
---

This command invocation explicitly requests the repository's commit-and-push workflow. Read and follow `.agents/skills/commit-and-push/SKILL.md`, `.agents/rules/commits.md`, `.agents/rules/no-auto-commit.md`, `.agents/rules/git-model.md`, and `.agents/agents/git-ops.md`.

Review the full working tree, including staged, unstaged, and untracked changes across all workspaces. Follow any additional scope or instructions here: $ARGUMENTS

Use the `git-ops` agent when the host provides it; otherwise run routine git commands directly. Stage specific paths by name, split unrelated changes into logical commits when appropriate, use Conventional Commit messages, and never bypass hooks. Commit and push the pending changes as requested by this command. If work should be excluded, the push target is unclear, or there are conflicts you cannot resolve confidently, stop and ask before changing git state. Report the resulting commit(s) and push status.
