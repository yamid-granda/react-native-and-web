# in-progress

Proposals claimed by `code-optimization-proposals-implement` and currently being
implemented. A proposal is claimed by **moving it here on `main` and committing
that move**, before any code is written.

That ordering is deliberate. The claim lands on `main` immediately, so the next run
can see it and move on to a different proposal. Archiving straight to
`implemented/` in the pull request would leave `main` still showing the proposal as
`todo` until a human merged, and the routine would reselect the same file every hour
and stall on it.

An entry here with no open pull request and no pushed branch is an orphaned claim
from a run that died. The routine reclaims those by moving them back to `todo/`.

Each pull request moves its proposal from here into `implemented/` in the same
pull request as the implementation.