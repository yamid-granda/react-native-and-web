# Scheduled routines

Each subdirectory is one scheduled routine, managed by the
[opencode-scheduler](https://www.npmjs.com/package/opencode-scheduler) plugin.
The directory name **is** the routine's slug, and that slug is what ties the
three things below together.

## Layout

```text
.opencode/schedule/
├── README.md
├── <routine-slug>/
│   └── PROMPT.md      # the routine's complete instructions
└── <another-routine-slug>/
    └── PROMPT.md
```

`<routine-slug>` must match the job's `name` passed to `schedule_job`, which in
turn determines the launchd label:

```text
com.opencode.job.<scopeId>.<routine-slug>
```

`scopeId` is derived from the job's `workdir`, so it is stable for a given
checkout path but changes if the repository moves.

## Why `PROMPT.md` is attached rather than inlined

A job points at this file with `--file`, so the file is read **at run time**:

```text
opencode run --model <model> --auto --file .opencode/schedule/<slug>/PROMPT.md -- "<one-line pointer>"
```

The job's stored prompt is only a pointer that tells the agent to read and follow
`PROMPT.md`. Editing this file therefore changes the next run with no
`update_job` call. Do not paste the instructions into the job's `prompt` field —
that reintroduces a second copy that silently goes stale.

## Adding a routine

1. Create `.opencode/schedule/<new-slug>/PROMPT.md`. Start it with
   `@scheduled-job-best-practices`, which is installed at
   `.opencode/skill/scheduled-job-best-practices/SKILL.md`.
2. Schedule it, using the slug as the name and this file as the attachment:

   ```text
   schedule_job {
     name: "<new-slug>",
     schedule: "0 * * * *",
     prompt: "Read the attached instructions file PROMPT.md and execute it exactly as written. ...",
     files: "<repo>/.opencode/schedule/<new-slug>/PROMPT.md",
     workdir: "<repo>",
     model: "opencode-go/space-bunny-free",
     auto: true,
     timeoutSeconds: 2700
   }
   ```

## Conventions this repository relies on

- **`auto: true` is required.** The supervisor denies `question` prompts, but
  ordinary tool permissions — file writes, shell, git — would otherwise block an
  unattended run until `timeoutSeconds` kills it. Without `--auto` a routine that
  is supposed to commit will hang and time out.
- **Durable artifacts go under `outputs/<routine-slug>/`** in the job workdir, per
  the best-practices skill. Routines with a stronger existing convention should
  keep it: this repository's proposal routine writes to
  `code-optimization-improve-proposals/` instead.
- **Compute runtime values with tools.** No `__TODAY__`-style placeholders are
  injected; use `date` during the run.
- **End every run with the Output Contract** block defined in each `PROMPT.md`, so
  the outcome is readable from the job log without opening the scheduler UI.

## Operating a routine

The `routine:*` scripts in the repository root drive the
`code-optimization-proposals` routine. For other routines, use the plugin tools
(`list_jobs`, `get_job`, `job_logs`, `run_job`, `update_job`) or `launchctl`
directly — see the plugin README for the storage layout.

## Current routines

| Slug | Schedule | What it does | Lands on |
|------|----------|--------------|----------|
| `code-optimization-proposals` | `0 * * * *` | Reviews the repo and writes at most one proposal to `code-optimization-improve-proposals/todo/` | commits straight to `main` |
| `code-optimization-proposals-implement` | `30 * * * *` | Claims the oldest actionable `todo/` entry and implements it | claim to `main`, then branch + pull request |
| `code-optimization-proposals-review-and-merge` | `45 * * * *` | Reviews the oldest open `code-optimization-improve-proposals/` pull request, then pushes corrections **or** merges it | corrections to the same branch, or a squash merge to `main` |

The three offsets are deliberate. All three routines touch the same repository, and
the plugin's lock only stops a routine from overlapping *itself* — not two
different routines. Staggering them keeps them out of each other's way, and also
keeps a routine from committing to `main` while the other holds the git index. The
reviewer runs at `:45` so it is downstream of the implementer's `:30` start, and
still leaves a 15-minute gap before the next hour's proposer.

Together they close the loop: **propose → implement → review and merge.** A proposal
becomes a pull request, the pull request is independently verified, and the merge
is what archives the proposal document into `implemented/`.

## Proposal lifecycle

The routines are coupled through the folder structure of
`code-optimization-improve-proposals/` and through pull-request titles, not
through conversation:

```text
todo/ ──claim on main──▶ in-progress/ ──PR merges──▶ implemented/
   │                          │
   └────▶ rejected/ ◀─────────┘
```

- The proposer writes to `todo/` only, and refuses to write anything that already
  exists in any of the four folders.
- The implementer **claims** a proposal by moving it `todo/` → `in-progress/` and
  committing that to `main` **before writing any code**. The claim is what makes
  progress durable.
- The implementation pull request then carries the second move,
  `in-progress/` → `implemented/`. The reviewer treats a missing or wrong move as
  a blocking defect and fixes it before merging.
- The reviewer identifies implementation pull requests **only** by the
  `code-optimization-improve-proposals/` prefix on the head branch, and always
  picks the oldest open one. It handles exactly one per run, so a backlog drains
  at one per hour instead of being reviewed in a rush.

**Why the claim is committed to `main` first.** If the archive to `implemented/`
only happened on merge, `main` would keep listing the proposal under `todo/` until
a human merged, and the routine would reselect the same file every hour and stall
on it — which is exactly what happened before this structure existed. Claiming up
front makes the next run's view of the queue accurate regardless of merge state.

An `in-progress/` entry with no open pull request and no pushed branch is an
orphaned claim from a run that died; the implementer's preflight reclaims those
back to `todo/`. No routine may stop because a candidate is unavailable — they skip
it and take the next one. See each routine's `PROMPT.md` for the full rules.

**Why the reviewer never merges what it just fixed.** When its review finds a
defect, the reviewer pushes the correction to the same branch and leaves the pull
request open. The next run — which selects the oldest open pull request again, so
still the same one — re-verifies it from scratch and merges it. Every merge is
therefore performed by a review pass that did not write the code. The only
exception is the missing `in-progress/` → `implemented/` move, which the reviewer
still routes through a fresh pass rather than merging directly, so the archive is
never landed unverified.

Runs are supervised: a lock file prevents a routine from overlapping itself, and
`timeoutSeconds` hard-stops a stuck run with SIGTERM then SIGKILL. Note that
`launchctl bootout` unloads the job but does **not** kill a run already in
flight, because the supervisor detaches its child into its own session.