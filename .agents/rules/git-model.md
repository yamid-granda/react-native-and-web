# Git workflow

Every git operation — `commit`, `pull`, `merge`, `push`, `rebase`, `status`,
`diff`, and the rest — runs in the repository's `git-ops` agent, never inline
in the calling agent. That agent is pinned to the **Space Bunny Free** model,
which OpenCode resolves as `opencode-go/space-bunny-free`. Hosts that cannot
resolve that provider (Claude Code's `model` field only accepts Anthropic model
names) leave the agent's model unpinned so it inherits the session model.

Do not commit or push unless the user explicitly asks (see
`no-auto-commit.md`). Treat destructive operations — including force-push,
history rewrites, and `reset --hard` — as requiring explicit user approval.
