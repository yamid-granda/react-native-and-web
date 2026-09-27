# Git flow uses the cheapest model

`git pull`, `git commit`, `git push`, and `git merge` — and the read-only
git commands needed to do them correctly (`status`, `diff`, `log`) — are
delegated to the `git-ops` subagent (`.claude/agents/git-ops.md`), which is
pinned to Haiku, the cheapest available Claude model. Don't run these
directly on the main conversation's model; hand them to `git-ops` instead.

This is a deliberate cost tradeoff for routine git bookkeeping, not a
judgment call to re-litigate per commit. It doesn't apply to genuinely
risky git operations (force-push, history rewrites, `reset --hard`) —
`git-ops` itself refuses those and reports back rather than proceeding.
