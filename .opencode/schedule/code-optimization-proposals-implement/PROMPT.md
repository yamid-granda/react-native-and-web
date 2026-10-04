@scheduled-job-best-practices

# Routine — apply one code-optimization proposal

You are an expert software architect running an **unattended, hourly** routine on
this monorepo (`react-native-and-web`). Each run claims the **oldest actionable**
proposal from `code-optimization-improve-proposals/todo/`, implements it, and opens a
pull request.

You have no human to answer questions. Decide, act, and record your reasoning.

This routine is the counterpart to `code-optimization-proposals`, which *writes*
proposals to `todo/` every hour. You *apply* one. It runs at `:30` so the two never
contend for the repository at the same time.

## This routine never stops

A run must always end by doing the next useful thing, not by giving up. In
particular:

- **Never stop because the oldest proposal is already claimed, already open as a
  pull request, or otherwise unavailable.** Skip it and take the next one. Only
  `skipped` — meaning *nothing at all* was actionable — is an acceptable reason to
  write no code.
- **Never stop because of a superseded, unreachable, or already-fixed target.** Move
  that proposal to `rejected/` and continue with the next candidate.
- **Never stop because a candidate's branch or pull request already exists.** That is
  the normal state of an in-flight proposal, and it is handled by the lifecycle
  below, not by stopping.
- If a genuine error blocks you, report it and exit — but then the *next* run must
  still make progress, so never leave work claimed and abandoned.

Only one run executes at a time; the scheduler's lock enforces that. You will not
be racing another instance of yourself.

## Preflight

Run these first. Every git operation — including `gh pr` — goes through the
repository's `git-ops` agent, never inline.

1. **`gh` is available and authenticated.** `gh auth status` must report a logged-in
   account. Without it you cannot open the pull request, which is this routine's
   whole output. If it is not authenticated, stop and report — do not attempt to
   authenticate interactively.
2. **`git fetch origin main`.** Read the proposal folders from `origin/main`, not from
   a possibly stale local tree.
3. **You are on `main`, `main` is not behind `origin/main`, and the working tree is
   clean.** If a previous run of this routine died on a
   `code-optimization-improve-proposals/*` branch, that branch's work was either
   pushed or lost; switch back to `main` and continue. Do not resume the dead branch.
4. **Reclaim orphaned claims.** List `code-optimization-improve-proposals/in-progress/`
   on `origin/main`. For each proposal there, check whether a pull request exists whose
   branch or title starts with `code-optimization-improve-proposals/` and contains
   that proposal's filename:
   - **A pull request exists** → leave it alone. It is in flight, awaiting review.
   - **No pull request and no matching branch exists** → the run that claimed it died.
     Move it back to `todo/` (`git mv`) and commit that on `main` via the
     `/cc-commit-and-push` workflow, then carry on. Report the reclaim.

## Select the proposal

1. List the proposal files under `code-optimization-improve-proposals/todo/` on
   `origin/main`, ignoring `README.md`.
2. Sort them **lexicographically ascending**. Every proposal filename begins
   `YYYY-MM-DD-HH-mm-ss-`, so lexicographic order *is* chronological order. Do not sort
   by modification time — a checkout or a merge changes mtimes.
3. Walk that list in order and take the **first proposal you can act on**. Before
   claiming one, read it and confirm:
   - its **Proposed approach** names `file:line` targets that still exist in this
     repository. If a target has moved and the change cannot be re-derived from the
     proposal's intent, this proposal is **not actionable** — move it to
     `rejected/`, record why in the file, commit that to `main`, and take the next
     candidate.
   - it is not already implemented by something in `implemented/`. If it is, move it
     to `rejected/` noting which proposal supersedes it, and take the next candidate.
4. If the whole list is empty, reply with exactly `No changes needed` and stop. That
   is success, not failure.

Claiming happens in the next step. Do not skip it — it is what stops the next run
from reselecting the same file.

## Step 1 — claim the proposal on `main`

**Before writing any code**, move the chosen proposal from `todo/` to `in-progress/`
and commit that move straight to `main`, using this repository's
`/cc-commit-and-push` workflow (read `.agents/skills/commit-and-push/SKILL.md`
together with `.agents/rules/commits.md`, `.agents/rules/git-model.md`, and
`.agents/rules/no-auto-commit.md`).

```text
git mv code-optimization-improve-proposals/todo/<file>.md \
       code-optimization-improve-proposals/in-progress/<file>.md
```

Stage **only** that move. Conventional Commits, scope
`code-optimization-improve-proposals`, for example:

```text
docs(code-optimization-improve-proposals): claim one body behind the platform splits
```

This claim is the routine's progress mechanism. Because it lands on `main` before any
code is written, the next run sees the proposal as claimed and moves on to a
different file. Never batch this move in with the implementation commit — the
implementation belongs on the branch, and the claim has to be visible immediately.

This scheduled run is the explicit user request that `.agents/rules/no-auto-commit.md`
requires for this step.

## Step 2 — implement it

Create the branch **from `main`** (which now carries the claim):

```text
code-optimization-improve-proposals/<proposal-filename-without-.md>
```

For `2026-10-03-22-15-47-move-seller-route-wiring-into-components-library.md` the
branch is:

```text
code-optimization-improve-proposals/2026-10-03-22-15-47-move-seller-route-wiring-into-components-library
```

The `code-optimization-improve-proposals/` prefix is **required**. Other routines
identify optimisation pull requests by this prefix; a pull request without it is
invisible to them. The filename is exact — do not add suffixes.

Then:

- Follow the proposal's **Proposed approach** section. It names concrete `file:line`
  targets; re-read them in this run.
- Make the **smallest change that fits the existing architecture**. Read the scoped
  `AGENTS.md` for whichever workspace you touch, and follow
  `.agents/rules/component-reuse.md` before moving shared UI.
- Update tests alongside behaviour changes, following the nearest tests' conventions.
- Do not fix unrelated problems, reformat untouched files, or bump dependencies. If
  you notice something else worth changing, mention it in your summary and leave it.
- If the branch already exists on the remote, that means a previous run claimed this
  proposal and pushed work. Do **not** force-push over it. Treat the existing branch
  as the work in progress: rebase your work onto it or abandon this attempt, and move
  the proposal to `rejected/` only if it is genuinely unworkable. Never destroy
  unlanded work to satisfy the branch-naming rule.

## Step 3 — verify before you push

Nothing gets pushed until these pass.

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
     state in the pull request description that the app was not launched on a
     simulator.
   - `api-rs` end-to-end tests need Docker. Docker being available does not mean you
     must run the whole E2E suite; run it only if your change touches `api-rs`.

If you cannot make something pass, stop and report. Do not open a pull request with
failing tests, and do not weaken a test to make it pass. Leave the claim in
`in-progress/` — the next run's preflight will see no pull request for it and reclaim
it to `todo/`.

## Step 4 — open the pull request

1. In the same branch, move the proposal file on to its final home:

   ```text
   git mv code-optimization-improve-proposals/in-progress/<file>.md \
          code-optimization-improve-proposals/implemented/<file>.md
   ```

   The pull request therefore carries both the implementation and the archive, which
   is what closes the proposal once the pull request merges.

2. Commit the implementation and the move. Conventional Commits, scoped to the
   workspace you changed, describing the behaviour rather than the proposal:

   ```text
   refactor(components-library): move seller route wiring into the shared screen
   ```

3. Push the branch with upstream tracking. Never force-push, never amend, never
   rewrite history, never bypass husky or commitlint.

4. Open the pull request against `main`:
   - **Title:** exactly the branch name,
     `code-optimization-improve-proposals/<proposal-filename-without-.md>`. The same
     prefix convention applies here.
   - **Body:** the proposal's content **rewritten in simple words** — a few short lines
     a non-specialist can follow. Do not paste the whole proposal, do not restate the
     diff, and do not expand it into an essay. Cover: what was wrong, what changed, and
     how it was verified (the commands you ran and their result). Note anything a
     reviewer should look at closely, and note explicitly if mobile was not launched
     on a simulator.

## Step 5 — clean up

- Make sure `main` is checked out in this working directory when you finish,
  including when you stopped early. The `code-optimization-proposals` routine refuses
  to run unless `main` is checked out, so leaving a branch behind blocks it.
- Leave no dev server, test watcher, or background process running.
- Leave the proposal in `in-progress/`. Its move to `implemented/` happens on merge,
  and until then it is correctly claimed and visible.

## Output contract

End every run with this block. The scheduler captures the run log, so this is how a
human reads the outcome without opening the log.

```
Status: success | skipped | failed
Reason: <one line>
Scanned: <how many todo/ candidates, and any that were skipped or rejected and why>
Proposal: <proposal filename, or "none">
Branch: <branch name, or "none">
Pull request: <PR URL, or "none">
Tests: <commands run and result, or "not run">
Verified: <typecheck / lint / web build — or what was skipped and why>
```

`success` means a proposal was implemented and a pull request opened — **including
the case where you skipped one or more earlier candidates to get there**; list those
under `Scanned`. `skipped` means `todo/` had no actionable proposal at all. `failed`
means a genuine error stopped the run; say which, and state what you left claimed.