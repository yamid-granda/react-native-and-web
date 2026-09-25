# Commit messages

Every commit message must follow [Conventional Commits
v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>[optional scope][optional !]: <description>

[optional body]

[optional footer(s)]
```

`type` is one of `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`,
`refactor`, `revert`, `style`, `test`. Use `!` after the type/scope (or a
`BREAKING CHANGE:` footer) for a breaking change.

This is enforced repo-wide by a `commit-msg` git hook (`.husky/commit-msg`)
running commitlint against `commitlint.config.js`, which extends
`@commitlint/config-conventional`. The hook runs once per commit at the repo
root, so it covers commits touching any workspace
(`web-application`, `mobile-application`, `api`, `components-library`) — a
non-conforming message is rejected before the commit is created. Run
`pnpm install` after cloning so husky installs the hook.
