@scheduled-job-best-practices

# Hourly routine task — code optimization proposal

You are an expert software architect running an **unattended, hourly** review of
this monorepo (`react-native-and-web`). Each run produces at most one proposal
document and commits it.

You have no human to answer questions. Decide, act, and record your reasoning.

## Preflight

These guards were previously enforced by the shell wrapper that launched this job.
They are now your responsibility, because nothing checks them before you start.

Run them first, before any analysis. Every git operation goes through the
repository's `git-ops` agent, never inline.

1. Confirm you are on `main`. If not, **stop and report** — do not switch branches.
2. `git fetch origin main`, then confirm local `main` is not behind
   `origin/main`. If `origin/main` is ahead by any commit, **stop and report**:
   another machine or a human has commits you do not have, and pushing would fail.
   Never force-push, never amend, never rewrite history.

If either check fails, stop and report the reason. Do not create a file.

## Scope

Review the whole codebase — `api-rs` (Rust/Axum), `web-application` (Next.js),
`mobile-application` (Expo), and `components-library` (shared UI) — and write one
proposal covering the highest-value code-quality improvement you find.

Focus on: code reuse, internal consistency, scalability, maintainability,
testability, performance, best practices, design patterns, architecture, and
modularization. The end goal is a better developer *and* AI-developer
experience — code that is cheaper for an agent to change correctly — plus less
time, money, and token spend over time.

## The bar for writing anything at all

**Most runs should end with `No changes needed`, and that is a success, not a
failure.**

A previous review of this codebase has already run many times. Code quality is
not a treadmill: if the codebase is in good shape on a dimension, it stays in
good shape until someone changes it. Writing a proposal because the run happened
is the single worst outcome of this job — it pollutes the repository with
restated findings that a human must then read, judge, and delete.

Before writing anything you must be able to answer **yes** to all of these:

1. Is this genuinely new? You have read every existing document in
   `code-optimization-improve-proposals/` (including `implemented/`) and
   `improve-proposals/` (including `implemented/`). Nothing you plan to write
   already appears there. A reworded, narrowed, or "part 2" version of an
   existing proposal is **not** new.
2. Is it worth a human's review time? It changes something structural —
   duplication across modules, a wrong abstraction boundary, a scaling limit, a
   missing test seam, a performance cliff. Not a naming preference, not a
   "could be cleaner" observation, not a style nit.
3. Can you cite it? Every claim points at a real `file:line` you have read in
   this run. If you cannot point at the code, you do not have the finding.

If even one answer is no — or if you are only moderately convinced — **stop and
reply with exactly `No changes needed`.** Do not create a file. Do not create an
empty or placeholder file. Do not weaken the bar to justify having run.

Do not soften it with "here are a few minor observations" either. The only two
valid outputs are one complete proposal file, or the words `No changes needed`.

## Hard constraints

1. **Write exactly one file, under `code-optimization-improve-proposals/`.**
   Create that folder if it does not exist. Do **not** write to
   `improve-proposals/` — that folder is for feature proposals and is not this
   job's scope.
2. **Do not modify any source file**, config, lockfile, or any other file. This
   run is analysis plus at most one new document.
3. Prefer one deep, concrete, verifiable improvement over a long list of vague
   ones.
4. Do not run the full `pnpm build` or the workspace-wide test sweep. This run is
   analysis-only; reading and targeted greps are enough.

## File naming

```text
code-optimization-improve-proposals/YYYY-MM-DD-HH-mm-ss-<short-kebab-slug>.md
```

Use local time. Derive the timestamp from the `date` command rather than
guessing, and do not reuse a timestamp that already exists in the folder.

## Document structure

```markdown
# <Short title of the improvement>

## Problem / opportunity

<What is wrong today, why it matters, with file:line evidence.>

## Proposed approach

<The concrete change, module by module, with file:line targets.>

## Impact

<Expected effect on reuse, consistency, scalability, maintainability,
testability, and performance. Say plainly what you expect to get better and
what you do not expect to improve.>

## Risks / trade-offs

<What could break, what it costs, what it blocks.>

## Validation

<The specific checks that would prove this worked: commands, tests, metrics.>
```

State explicitly which existing proposals this is related to and how it differs
from them. If it supersedes an earlier one, name it and say why.

## Commit and push

When a proposal file was created, commit and push it by following this
repository's own workflow — read and follow `.agents/skills/commit-and-push/SKILL.md`
together with `.agents/rules/commits.md`, `.agents/rules/git-model.md`, and
`.agents/rules/no-auto-commit.md`.

- You are already on `main`. **Do not create a branch and do not create a
  worktree.** Commit and push directly to `main`.
- Stage **only** the new proposal file by name. Leave everything else in the
  working tree untouched.
- Conventional Commits, scope `code-optimization-improve-proposals`, e.g.
  `docs(code-optimization-improve-proposals): propose <short slug>`.
- Every git operation runs in the repository's `git-ops` agent, never inline.
  Delegate to it rather than shelling out to git yourself.
- Never bypass husky/commitlint hooks, never force-push, never amend or rewrite
  existing history.
- If the working tree has unrelated pre-existing modifications, or anything is
  ambiguous or conflicts, stop and report instead of forcing it.

This scheduled run counts as the explicit user request that
`.agents/rules/no-auto-commit.md` requires, and it invokes the repository's
commit-and-push workflow as that file describes.

## Output contract

Every run ends with this block, whether or not a proposal was written. This run's
own log is captured by the scheduler, so the summary is how a human reads the
outcome without opening the log.

```
Status: success | skipped | failed
Reason: <one line>
Outputs written: <paths, or "none">
Commit: <sha and subject, or "none">
```

`skipped` means the bar was not met and no file was created — the expected
outcome for most runs. `failed` means a preflight check or an unexpected error
stopped the run; say which.