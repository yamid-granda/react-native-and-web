---
description: Start a new task in its own git work tree, deduced name and branch, then implement it there
---

This command invocation explicitly requests the repository's start-task workflow. Read and follow `.agents/skills/start-task/SKILL.md`, `.agents/rules/git-model.md`, `.agents/rules/no-auto-commit.md`, and `.agents/agents/git-ops.md`.

Follow any additional scope or instructions here: $ARGUMENTS

Use the `git-ops` agent for the git operations that create the work tree; it is pinned to the Space Bunny Free model required by `.agents/rules/git-model.md`, so do not run those git commands inline. Create the new work tree first, then move this session into it with the session-move tool and confirm `git rev-parse --show-toplevel` prints the new work tree path before making any edit. The work tree the session started in — including `main` — is read-only: never implement the task there and never copy the finished files over afterwards.

Work through the workflow in order: preflight the existing work trees, derive the `<owner>/<type>-<summary>` branch and the sibling work tree path from the instructions, create the work tree from `origin/main`, move the session and verify the move, install dependencies when the work tree has none, then do the work. Being called from `main` or from another task's work tree changes none of this — it still gets its own new work tree. If the instructions are too vague to name a task, or the derived name already exists as a branch or a directory, stop and ask instead of guessing. Never commit or push — the user reviews the changes first, then lands them with `/cc-commit-and-push` or `/cc-accept-work-tree`. Report the branch, the work tree path, the base ref, that the session now works in the new work tree and the calling one was left untouched, what you implemented, and the checks you ran or could not run.