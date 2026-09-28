#!/usr/bin/env bash
# PreToolUse gate for EnterPlanMode/ExitPlanMode. Auto-approves only while
# .claude/.auto-plan-mode-active exists and is fresh; otherwise falls through
# to the normal approval prompt. The marker is set by /cc-auto-plan-mode
# (.claude/skills/cc-auto-plan-mode/SKILL.md) and cleared right after use, so
# a crash-orphaned marker can't silently auto-approve later, unrelated /plan
# sessions.
set -euo pipefail

# 1800s (30min) was too tight: a thorough plan-mode research pass can run
# longer than that, so ExitPlanMode's approval would lapse before the plan
# was even ready. This ceiling only guards against a crash-orphaned marker
# that the command's own cleanup (step 6 of the skill) never got to run;
# under normal use the marker is deleted right after ExitPlanMode returns,
# long before this would matter.
MARKER=".claude/.auto-plan-mode-active"
MAX_AGE_SECONDS=21600

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
