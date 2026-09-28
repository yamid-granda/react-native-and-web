---
name: cc-auto-plan-mode
description: Run plan mode end-to-end without stopping for plan approval — enter plan mode, research, write a plan, then trust that first plan and execute it immediately. Use when the user runs /cc-auto-plan-mode <task> or explicitly asks for plan mode without the approval step.
---

Do the task the user gives after `/cc-auto-plan-mode`, using plan mode, but
skip the "approve this plan?" stop — trust the first plan version and go
straight to implementing it.

1. Arm the auto-approval window: `date +%s > .claude/.auto-plan-mode-active`.
   This marker is read by the `PreToolUse` hook in
   `.claude/hooks/auto-plan-mode-gate.sh` (wired in `.claude/settings.json`),
   which auto-approves the very next `EnterPlanMode`/`ExitPlanMode` call made
   within the following 6 hours (a generous ceiling meant only to catch a
   crash-orphaned marker, not to bound normal research time) and otherwise
   does nothing — normal `/plan` usage without this marker still prompts as
   usual.
2. Call `EnterPlanMode` (auto-approved because the marker exists).
3. Research the codebase and design the approach exactly as you would for a
   normal plan-mode task — same depth, same rigor.
4. Write the plan to the plan file.
5. Call `ExitPlanMode` (auto-approved because the marker is still fresh).
6. Immediately delete the marker: `rm -f .claude/.auto-plan-mode-active`. Do
   this right after `ExitPlanMode` returns, whether or not it succeeded, so
   the window closes the moment it's used rather than staying armed for a
   later, unrelated `/plan` call in the same session.
7. Proceed straight to implementing the plan. Do not ask "should I proceed?"
   or otherwise wait for confirmation — invoking this command *is* the
   user's approval.

This only bypasses the plan-approval gate. It does not change anything else:
individual risky actions during implementation (git push, destructive
commands, etc.) still go through the user's normal tool permissions and this
repo's own rules (`.agents/rules/no-auto-commit.md`,
`.agents/rules/git-model.md` — still hand git flow to `git-ops`, still don't
commit unless asked).
