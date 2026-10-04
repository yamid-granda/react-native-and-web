@scheduled-job-best-practices

# Routine — apply one code-optimization proposal

You are an expert software architect running an **unattended, hourly** routine on
this monorepo (`react-native-and-web`). Each run takes **the oldest
not-yet-applied** proposal from `code-optimization-improve-proposals/`, implements
it, and opens a pull request.

You have no human to answer questions. Decide, act, and record your reasoning.

This routine is the counterpart to `code-optimization-proposals`, which *writes*
proposals directly to `main`. You *apply* one and open a PR. It runs at `:30` so
the two never contend for the repository at the same time.

## Preflight

Run these first. Every git operation — including `gh pr` — goes through the
repository's `git-ops` agent, never inline.

1. **`gh` is available and authenticated.** `gh auth status` must report a logged-in
   account. Without it you cannot open the pull request, which is this routine's
   whole output. If it is not authenticated, stop and report — do not attempt to
   authenticate interactively.
2. **You are on `main`, and it is not behind `origin/main`.** If a previous run of
   this routine died while on a `code-optimization-proposals/*` branch, that branch's
   work was already pushed or is lost; the PR can be recreated. Switch back to `main`
   and continue. Do not resume the abandoned branch.
3. **`origin/main` is fetched**, so the proposal list you read is current.

If any check fails, stop and report the reason. Do not create a branch.

## Select the proposal

1. `git fetch origin main`, then list the proposal files on `origin/main` under
   `code-optimization-improve-proposals/`.
2. Ignore `README.md` and everything under `implemented/`.
3. Sort the remaining filenames **lexicographically ascending**. Every proposal
   filename begins `YYYY-MM-DD-HH-mm-ss-`, so lexicographic order *is* chronological
   order. Do not sort by modification time — a checkout or a merge changes mtimes.
4. Take the **first** one. That is the oldest unimplemented proposal.
5. If there are none left, reply with exactly `No changes needed` and stop. That is
   success, not failure.

## Apply the proposal

Read the chosen proposal in full before touching anything. Then:

- Follow its **Proposed approach** section. It names concrete `file:line` targets.
- Re-read those files in this run. A proposal may describe code that has since moved;
  if a target no longer exists, stop and report that rather than improvising a
  different change.
- Make the **smallest change that fits the existing architecture**. Read the scoped
  `AGENTS.md` for whichever workspace you touch, and follow
  `.agents/rules/component-reuse.md` before moving shared UI.
- Update tests alongside behaviour changes, following the nearest tests' conventions.
- Do not fix unrelated problems, reformat untouched files, or bump dependencies. If
  you notice something else worth changing, mention it in your summary and leave it.

## Verify before you push

Nothing gets committed until these pass.

1. **Tests.** Run the tests covering the code you changed — the workspace suite for
   each area you touched. `pnpm test` runs the workspace unit/component suites.
   Narrow first (`pnpm --filter @rnw/components-library test`), then broader if the
   change reaches shared code. If a test fails, **fix it** and re-run. If a test fails
   for a reason unrelated to your change, say so explicitly instead of deleting it.
2. **Types and lint.** `pnpm typecheck` and `pnpm lint` must both pass.
3. **Dev environment and app.** The environment must actually work, not merely
   typecheck:
   - `pnpm install` if `node_modules` is missing or stale.
   - The web application must build and serve. `pnpm --filter @rnw/web-application build`
     is the reliable unattended check; if you start `pnpm dev` instead, confirm the app
     responds and shut it down again. Never leave a dev server running.
   - **Mobile is out of scope.** `mobile-application` needs a native simulator, which
     an unattended run cannot rely on. If your change touches
     `mobile-application/src/`, verify with typecheck, lint, and its unit tests, and
     state in the PR description that the app was not launched on a simulator.
   - `api-rs` end-to-end tests need Docker. Docker being available does not mean you
     must run the whole E2E suite; run it only if your change touches `api-rs`.

If you cannot make something pass, stop and report. Do not open a pull request with
failing tests, and do not weaken a test to make it pass.

## Branch, commit, push

1. Create the branch **from `main`**:

   ```text
   code-optimization-improve-proposals/<proposal-filename-without-.md>
   ```

   For example, for
   `code-optimization-improve-proposals/2026-10-03-22-15-47-move-seller-route-wiring-into-components-library.md`
   the branch is:

   ```text
   code-optimization-improve-proposals/2026-10-03-22-15-47-move-seller-route-wiring-into-components-library
   ```

   The `code-optimization-improve-proposals/` prefix is **required**. Other routines
   identify optimisation pull requests by this prefix; a PR without it is invisible to
   them.

2. Commit the implementation. Conventional Commits, scoped to the workspace you
   changed, describing the behaviour rather than the proposal:

   ```text
   refactor(components-library): move seller route wiring into the shared screen
   ```

3. Also commit the proposal file **moved** into `implemented/`, in the same commit or
   a separate one:

   ```text
   git mv code-optimization-improve-proposals/<file>.md \
          code-optimization-improve-proposals/implemented/<file>.md
   ```

   This is how the next run knows the proposal is done. **Do not delete the file** —
   archive it, so the history of what was proposed stays intact.

4. Push the branch with upstream tracking. Never force-push, never amend, never
   rewrite history, never bypass husky or commitlint.

## Pull request

Open the PR against `main`:

- **Title:** exactly the branch name,
  `code-optimization-improve-proposals/<proposal-filename-without-.md>`. The same
  prefix convention applies here.
- **Body:** the proposal's content **rewritten in simple words** — a few short lines a
  non-specialist can follow. Do not paste the whole proposal, do not restate the diff,
  and do not expand it into an essay. Cover: what was wrong, what changed, and how it
  was verified (the commands you ran and their result). Note anything a reviewer should
  look at closely, and note explicitly if mobile was not launched on a simulator.

## Clean up

- Make sure `main` is checked out in this working directory when you finish, including
  when you stopped early. The `code-optimization-proposals` routine refuses to run
  unless `main` is checked out, so leaving a branch behind blocks it.
- Leave no dev server, test watcher, or background process running.

## Output contract

End every run with this block. The scheduler captures the run log, so this is how a
human reads the outcome without opening the log.

```
Status: success | skipped | failed
Reason: <one line>
Proposal: <proposal filename, or "none">
Branch: <branch name, or "none">
Pull request: <PR URL, or "none">
Tests: <commands run and result, or "not run">
Verified: <typecheck / lint / web build — or what was skipped and why>
```

`skipped` means there was no proposal left to apply. `failed` means a preflight check
or an unexpected error stopped the run; say which.