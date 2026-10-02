---
name: cc-task
description: Start a new task in its own git work tree - derive a branch and work tree name from the instructions, create the work tree from origin/main, then implement the task inside it. Use when the user runs /cc-task or explicitly asks to start a task in a new work tree.
---

Read and follow `.agents/skills/start-task/SKILL.md` and
`.agents/rules/no-auto-commit.md`.

Use the given instructions to deduce the task's branch
(`<owner>/<type>-<summary>`) and work tree name, create that work tree from
`origin/main` next to the existing ones, move this session into it, and then
implement the task there.

When available, use the `git-ops` Claude subagent for the git operations that
create the work tree. This skill is an alias for Claude Code; the shared
workflow above is authoritative.

Leave the work uncommitted. `/cc-commit-and-push` and `/cc-accept-work-tree`
land it afterwards.