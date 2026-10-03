---
name: cc-task
description: Start a new task in its own git work tree - derive a branch and work tree name from the instructions, create the work tree from origin/main, then hand the task to opencode --auto in that work tree's own Orca tab. Use when the user runs /cc-task or explicitly asks to start a task in a new work tree.
---

Read and follow `.agents/skills/start-task/SKILL.md` and
`.agents/rules/no-auto-commit.md`.

Use the given instructions to deduce the task's branch
(`<owner>/<type>-<summary>`) and work tree name, create that work tree from
`origin/main` next to the existing ones, then hand the task to `opencode --auto`
running in that work tree's own Orca tab — never in the current tab, and never
editing in the work tree the session started in or in `main`. Create the work
tree with `orca worktree create`, then `orca terminal create --command
"opencode --auto"` inside it rather than `worktree create --agent opencode`,
which starts plain `opencode` without `--auto`. Wait for `--for tui-idle` and
send the task instructions only once the wait reports `satisfied: true`. Stop
once the prompt is accepted; the receiving agent does the implementation.

When no Orca CLI is available, take the documented git fallback: move this
session into the new work tree and implement the task there.

When available, use the `git-ops` Claude subagent for the git operations that
create the work tree. This skill is an alias for Claude Code; the shared
workflow above is authoritative.

Leave the work uncommitted. `/cc-commit-and-push` and `/cc-accept-work-tree`
land it afterwards.