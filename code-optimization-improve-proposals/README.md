# Code optimization proposals

Proposals for improving this codebase, and their lifecycle through it. Every stage
is automated by routines defined in `.opencode/schedule/`; see that directory's
README for how to run and inspect them.

## Lifecycle

```text
todo/ ──claim──▶ in-progress/ ──PR merges──▶ implemented/
   │                    │
   └── rejected/ ◀───────┘  (not actionable, or never will be)
```

| Folder | Meaning | Written by |
|--------|---------|------------|
| `todo/` | waiting to be implemented | `code-optimization-proposals` |
| `in-progress/` | claimed and being implemented right now | `code-optimization-proposals-implement` |
| `implemented/` | landed on `main` | the pull request that carried the change |
| `rejected/` | will not be implemented as written | `code-optimization-proposals-implement` |

A proposal is **claimed** by moving it `todo/` → `in-progress/` and committing that
move to `main`, before any code is written. The claim is therefore visible to the
next run immediately. The pull request that implements it then carries the second
move, `in-progress/` → `implemented/`.

Filename convention is `YYYY-MM-DD-HH-mm-ss-<short-kebab-slug>.md`, local time.
Because the prefix is a timestamp, sorting filenames lexicographically gives
chronological order — which is how the implementer picks the oldest `todo/` entry.

## How a proposal gets closed

`code-optimization-proposals-review-and-merge` closes the loop. It takes the
**oldest open pull request** whose branch starts with
`code-optimization-improve-proposals/` — at most one per run — reviews it against
the proposal document, and re-runs the tests, typecheck, lint, and web build
itself rather than trusting the pull request body.

- If the review finds defects, it fixes them on that same branch, re-runs the whole
  gate on what it pushed, and merges — in the same run. Merging is the objective.
- If the review finds nothing wrong, it merges straight away.

Either way it squash-merges with a Conventional Commits message of its own, and
declares any correction it made in the merge commit body.

A pull request that does not move its proposal document from `in-progress/` to
`implemented/` is a blocking defect: the document would never be archived when the
pull request lands. The reviewer fixes the move before it will merge.

A pull request the reviewer cannot fix without a human decision is recorded in
`outputs/code-optimization-proposals-review-and-merge/stalled.json` and skipped by
later runs, so one bad pull request cannot wedge the pipeline. The reviewer never
closes a pull request and never rejects a proposal itself.

## The bar

`code-optimization-proposals` writes at most one proposal per run, and **most runs
should write nothing at all**. A run that finds nothing worth a human's review time
should end with `No changes needed`; that is the expected outcome, not a failure.
See that routine's `PROMPT.md` for the three questions a proposal must answer.

## Reading order

Read `in-progress/` before proposing anything new, so you do not write a proposal
for work that is already underway. Read `implemented/` and `rejected/` before
proposing, so you do not duplicate a closed proposal.