---
description: Commit pending changes and push them to the current branch using this repository's git workflow
agent: git-ops
---

This command invocation explicitly requests the repository's commit-and-push workflow. Read and follow `.agents/skills/commit-and-push/SKILL.md`, `.agents/rules/commits.md`, `.agents/rules/no-auto-commit.md`, `.agents/rules/git-model.md`, and `.agents/agents/git-ops.md`.

This command already runs as the `git-ops` agent, which is pinned to the Space Bunny Free model, so perform every git operation here instead of delegating further.

Review the full working tree, including staged, unstaged, and untracked changes across all workspaces. Follow any additional scope or instructions here: $ARGUMENTS

Stage specific paths by name, split unrelated changes into logical commits when appropriate, use Conventional Commit messages, and never bypass hooks. Commit the pending changes, then push them to the current branch, setting its upstream if the branch has no remote tracking yet. If work should be excluded, the current branch is not the right push target, or there are conflicts you cannot resolve confidently, stop and ask before changing git state. Report the resulting commit(s) and push status.
