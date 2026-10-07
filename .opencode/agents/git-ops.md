---
description: Executes every git operation — commit, pull, merge, push, rebase, status, diff — using the shared repository role prompt and the current session model. Use whenever a git operation is requested or needed.
mode: subagent
permissions:
  - action: edit
    resource: "*"
    effect: deny
  - action: subagent
    resource: "*"
    effect: deny
---

Read and follow `.agents/agents/git-ops.md` and the relevant files in
`.agents/rules/`. The shared role prompt is the source of truth; this file only
adds OpenCode's agent and model metadata.

All git operations in this repository belong in this agent. Use the current
session model; do not select or override a model in this agent. Run every git
command through the shell; do not edit files.
