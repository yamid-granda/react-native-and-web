---
name: auto-plan-mode
description: Plan a substantial task, then implement it without pausing for a separate plan approval when the user explicitly invokes this workflow.
---

Use the host's native planning workflow when available:

1. Understand the request, inspect relevant code and project instructions, and identify risks and dependencies.
2. Write a practical implementation plan before editing.
3. If this workflow was explicitly invoked, treat that invocation as approval to proceed after writing the plan; do not ask for a second approval.
4. Implement the plan, run relevant checks, and report the result and any limitations.

This workflow only removes the separate plan-approval pause. It does not
authorize unrelated changes, committing/pushing, or destructive operations.
Follow the repository rules and the host's normal permissions for those actions.
