# Shared agent configuration

`.agents/` is the repository's provider-neutral source for agent guidance:

- `rules/` — project policies, linked from the root `AGENTS.md`.
- `agents/` — reusable role prompts for specialized agents.
- `skills/` — reusable task workflows.

The root `AGENTS.md` is the main entrypoint for tools that support `AGENTS.md`.
Provider entrypoints should import or point to it rather than copy its rules.
Claude Code and Gemini CLI have small root entrypoints for this purpose.

Keep provider-specific configuration in its native directory. For example,
`.claude/settings.json` and Claude's hook protocol cannot be made portable, so
`.claude/` contains only runtime settings and thin adapters that delegate to
the shared prompts and skills here. Do not duplicate common policy in those
adapters.
