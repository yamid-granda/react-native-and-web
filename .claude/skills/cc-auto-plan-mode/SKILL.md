---
name: cc-auto-plan-mode
description: Run plan mode end-to-end without stopping for plan approval — enter plan mode, research, write a plan, then trust that first plan and execute it immediately. Use when the user runs /cc-auto-plan-mode <task> or explicitly asks for plan mode without the approval step.
---

Read and follow `.agents/skills/auto-plan-mode/SKILL.md`. This file provides
the Claude Code-specific execution details for that shared workflow.

1. Arm the gate: `date +%s > .claude/.auto-plan-mode-active`. The
   `PreToolUse` hook in `.claude/hooks/auto-plan-mode-gate.sh` (wired in
   `.claude/settings.json`) allows plan-mode gates while this marker is fresh.
   It expires after six hours if cleanup fails; normal `/plan` use without the
   marker still prompts as usual.
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

This hook only bypasses Claude Code's plan-mode approval gate. It does not
change any other permissions or repository rules.
