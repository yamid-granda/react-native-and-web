---
description: Commit and push this work tree's branch, merge it into main, confirm it landed, then delete the work tree and its branch
model: opencode-go/muse-spark-1.3-contributor#minimal
---

This command invocation explicitly requests the repository's accept-work-tree workflow. Read and follow `.agents/skills/accept-work-tree/SKILL.md`, `.agents/skills/commit-and-push/SKILL.md`, `.agents/rules/commits.md`, `.agents/rules/no-auto-commit.md`, `.agents/rules/git-model.md`, and `.agents/agents/git-ops.md`.

Follow any additional scope or instructions here: $ARGUMENTS

This invocation is the explicit approval for the merge into `main`, the push to `main`, and the deletion of this work tree and the branch it holds. Anything beyond those steps still needs a separate ask: extra branches, `--force`, or touching work outside this work tree.

Use the `git-ops` agent when the host provides it; otherwise run routine git commands directly. This command always runs as `opencode-go/muse-spark-1.3-contributor#minimal` via its frontmatter `model` — mandatory, not a fallback. Do not inherit or switch models; this overrides the inherit-the-session-model rule in `.agents/rules/git-model.md`. Run the workflow in order: commit and push the branch, merge it into `main` from the work tree that has `main` checked out, confirm with `git merge-base --is-ancestor` that the branch tip is on `origin/main`, and only then remove the work tree, prune, and delete the local and remote branch. If the Phase 3 confirmation fails, stop and report without deleting anything. If this session's working directory is the work tree being removed, move the session to the main work tree before finishing. Report the merge commit, push status, confirmation result, and exactly what was removed.