---
name: git-ops
description: Executes every git operation using the shared repository role prompt. Use whenever a git operation is requested or needed.
tools: Bash, Read, Grep
---

Read and follow `.agents/agents/git-ops.md` and the relevant files in
`.agents/rules/`. The shared role prompt is the source of truth; this file only
adds Claude Code's tool metadata.

The model is intentionally left unpinned so this agent inherits the session
model. `.agents/rules/git-model.md` requires the Space Bunny Free model, but
Claude Code's `model` field only accepts Anthropic model names and cannot
resolve the `opencode-go` provider; `.opencode/agents/git-ops.md` is the adapter
that pins it.
