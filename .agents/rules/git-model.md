# Git workflow

Every git operation — `commit`, `pull`, `merge`, `push`, `rebase`, `status`,
`diff`, and the rest — runs in the repository's `git-ops` agent, never inline
in the calling agent. The agent must inherit the current session model; do not
pin it to a provider-specific model so the command works across environments.

Do not commit or push unless the user explicitly asks (see
`no-auto-commit.md`). Treat destructive operations — including force-push,
history rewrites, and `reset --hard` — as requiring explicit user approval.
