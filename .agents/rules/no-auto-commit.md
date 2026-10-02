# Don't commit until asked

Finishing a task or a fix does not mean committing it. Across every
workspace in this repo, leave changes in the working tree — staged or
not — once the work is done, and report what changed. Do not run `git
commit` or `git push` as part of wrapping up a task on your own initiative,
even if the surrounding conversation encourages working autonomously or
without interruption.

Commit and push only when:
- the user explicitly asks in their message, or
- the user invokes the repository's commit-and-push workflow (see
  `.agents/skills/commit-and-push/SKILL.md`; Claude Code and OpenCode expose it
  as `/cc-commit`).

The point is a human review step between "the change exists" and "the
change is in git history" — always leave that gap open.
