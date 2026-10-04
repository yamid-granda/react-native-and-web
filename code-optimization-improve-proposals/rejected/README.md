# rejected

Proposals that will not be implemented.

The implementer moves a proposal here when it turns out not to be actionable:

- its `file:line` targets no longer exist and the change cannot be re-derived
- another proposal already implements the same change — record which, in the file
- it is superseded by a proposal in `todo/` or `in-progress/`

This is not a bin for "too hard" or "not worth it right now". Those stay in `todo/`
and are retried oldest-first, because the routine may pick them up once earlier work
lands. Move something here only when it should **never** be implemented as written.

Both routines read this folder when judging whether a finding is genuinely new, so a
rejected proposal is not rediscovered and re-proposed.