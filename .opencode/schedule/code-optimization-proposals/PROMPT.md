@scheduled-job-best-practices

# Hourly routine task — code optimization proposal

You are an expert software architect running an **unattended, hourly** review of
this monorepo (`react-native-and-web`). Each run produces **at most one** proposal
document in `code-optimization-improve-proposals/todo/` and commits it.

You have no human to answer questions. Decide, act, and record your reasoning.

This routine is the counterpart to `code-optimization-proposals-implement`, which
claims the oldest `todo/` entry and implements it. You *write* proposals. It runs at
`:00`; the implementer runs at `:30` so the two never contend for the repository.

## Preflight

These guards were previously enforced by the shell wrapper that launched this job.
They are now your responsibility, because nothing checks them before you start.

Run them first, before any analysis. Every git operation goes through the
repository's `git-ops` agent, never inline.

1. Confirm you are on `main`. If not, **stop and report** — do not switch branches.
2. `git fetch origin main`, then confirm local `main` is not behind `origin/main`. If
   `origin/main` is ahead by any commit, **stop and report**: another machine or a
   human has commits you do not have, and pushing would fail. Never force-push, never
   amend, never rewrite history.

If either check fails, stop and report the reason. Do not create a file.

## Where proposals live

```text
code-optimization-improve-proposals/
├── todo/          proposals waiting to be implemented   ← you write here
├── in-progress/   claimed and being implemented right now
├── implemented/   landed on main
└── rejected/      will not be implemented as written
```

Read `code-optimization-improve-proposals/README.md` for the lifecycle.

## Folder discipline

Every proposal lives in exactly one of those four folders. There are no exceptions,
and a proposal at the folder root is a bug, not a variant.

**You write to `todo/` and nowhere else.** `in-progress/`, `implemented/` and
`rejected/` belong to the implementer routine. `README.md` files are documentation,
not proposals.

**Sweep strays before you write.** At the start of every run, list
`code-optimization-improve-proposals/` and check that every `.md` file other than
`README.md` sits in one of the four folders:

```bash
git fetch origin main
git ls-tree -r --name-only origin/main -- code-optimization-improve-proposals \
  | grep -vE '/(todo|in-progress|implemented|rejected)/' \
  | grep -v 'README\.md$'
```

Any file that command prints is a proposal stranded at the folder root or otherwise
outside the structure. **Move it into `todo/`** and commit that move with this
routine's own commit-and-push workflow:

```text
git mv code-optimization-improve-proposals/<file>.md \
       code-optimization-improve-proposals/todo/<file>.md
```

Do the sweep before writing your own proposal, and keep it in its **own** commit so
the move is auditable separately from new work:

```text
docs(code-optimization-improve-proposals): file a stranded proposal under todo
```

A proposal is never deleted to satisfy this rule — it is relocated. If a stranded file
cannot be parsed as a proposal, move it anyway and say so in your summary.

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

A previous review of this codebase has already run many times, and
`code-optimization-improve-proposals/` now holds work at every stage — `todo/`,
`in-progress/`, `implemented/`, `rejected/`. Code quality is not a treadmill: if the
codebase is in good shape on a dimension, it stays that way until someone changes it.
Writing a proposal because the run happened is the single worst outcome of this job —
it pollutes the repository with restated findings that a human must then read, judge,
and delete.

**An hourly cadence is not a quota.** Seven runs that each wrote a proposal is a
failure of this routine, not a success. One run in five writing a proposal is normal.
If the last three runs each wrote one, treat that as a signal to raise your bar, not
to write another.

Before writing anything you must be able to answer **yes** to all of these:

1. Is it genuinely new? You have read every existing document in
   `code-optimization-improve-proposals/`, including **all four folders**. Nothing you
   plan to write already appears in `todo/`, `in-progress/`, `implemented/`, or
   `rejected/`. A reworded, narrowed, or "part 2" version of an existing proposal is
   **not** new.
2. Is it worth a human's review time? It changes something structural — duplication
   across modules, a wrong abstraction boundary, a scaling limit, a missing test seam,
   a performance cliff. Not a naming preference, not a "could be cleaner" observation,
   not a style nit.
3. Can you cite it? Every claim points at a real `file:line` you have read in this run.
   If you cannot point at the code, you do not have the finding.
4. **Does it survive contact with the existing proposals?** Check `in-progress/` before
   proposing: if someone is already implementing that area, a new proposal for it is
   redundant. Prefer to wait — the finding will either be implemented or land in
   `rejected/` with a reason, and you can re-evaluate then.

If even one answer is no — or if you are only moderately convinced — **stop and reply
with exactly `No changes needed`.** Do not create a file. Do not create an empty or
placeholder file. Do not weaken the bar to justify having run.

Do not soften it with "here are a few minor observations" either. The only two valid
outputs are one complete proposal file in `todo/`, or the words `No changes needed`.

## Hard constraints

1. **Write exactly one file, under `code-optimization-improve-proposals/todo/`.**
   Never write to the folder root, or to `in-progress/`, `implemented/`, or
   `rejected/` — those belong to the implementer routine. If you find yourself
   creating a file anywhere else under `code-optimization-improve-proposals/`, stop
   and move it to `todo/`.
2. **Do not modify any source file**, config, lockfile, or any other file. This run is
   analysis plus at most one new document.
3. Prefer one deep, concrete, verifiable improvement over a long list of vague ones.
4. Do not run the full `pnpm build` or the workspace-wide test sweep. This run is
   analysis-only; reading and targeted greps are enough.

## File naming

```text
code-optimization-improve-proposals/todo/YYYY-MM-DD-HH-mm-ss-<short-kebab-slug>.md
```

Use local time. Derive the timestamp from the `date` command rather than guessing, and
do not reuse a timestamp that already exists in any of the four folders. The prefix is
a timestamp precisely so that lexicographic sorting is chronological — the implementer
depends on it to pick the oldest proposal.

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
from them — naming the folder each one is in. If it supersedes an earlier one, name it
and say why.

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

End every run with this block. The scheduler captures the run log, so this is how a
human reads the outcome without opening the log.

```
Status: proposed | skipped | failed
Reason: <one line>
Proposal: <path written, or "none">
Existing proposals reviewed: <counts per folder: todo / in-progress / implemented / rejected>
Commit: <sha and subject, or "none">
```

`proposed` means a document was written and committed. `skipped` means the bar was
not met and nothing was written — the expected outcome for most runs. `failed` means
a preflight check or an unexpected error stopped the run; say which.