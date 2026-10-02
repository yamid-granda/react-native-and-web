# Git workflow

Use the repository's `git-ops` agent when the host provides it; otherwise run
routine git commands directly. Do not commit or push unless the user explicitly
asks (see `no-auto-commit.md`). Treat destructive operations — including
force-push, history rewrites, and `reset --hard` — as requiring explicit user
approval.
