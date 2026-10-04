# Scheduled routines

Each subdirectory is one scheduled routine, managed by the
[opencode-scheduler](https://www.npmjs.com/package/opencode-scheduler) plugin.
The directory name **is** the routine's slug, and that slug is what ties the
three things below together.

## Layout

```text
.opencode/schedule/
└── <routine-slug>/
    └── PROMPT.md      # the routine's complete instructions
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

Runs are supervised: a lock file prevents a routine from overlapping itself, and
`timeoutSeconds` hard-stops a stuck run with SIGTERM then SIGKILL. Note that
`launchctl bootout` unloads the job but does **not** kill a run already in
flight, because the supervisor detaches its child into its own session.