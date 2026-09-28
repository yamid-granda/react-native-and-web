#!/usr/bin/env bash
# PreToolUse gate for EnterPlanMode/ExitPlanMode. Auto-approves only while
# .claude/.auto-plan-mode-active exists and is fresh; otherwise falls through
# to the normal approval prompt. The marker is set by /cc-auto-plan-mode
# (.claude/skills/cc-auto-plan-mode/SKILL.md) and cleared right after use, so
# a crash-orphaned marker can't silently auto-approve later, unrelated /plan
# sessions.
set -euo pipefail

MARKER=".claude/.auto-plan-mode-active"
MAX_AGE_SECONDS=1800

input="$(cat)"
tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty')"

if [[ ! -f "$MARKER" ]]; then
  exit 0
fi

marker_time="$(cat "$MARKER" 2>/dev/null || echo 0)"
now="$(date +%s)"
age=$(( now - marker_time ))

if [[ "$age" -gt "$MAX_AGE_SECONDS" ]]; then
  exit 0
fi

jq -n --arg reason "cc-auto-plan-mode: auto-approving $tool_name" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: $reason}}'
