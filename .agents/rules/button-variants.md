# Button variants

`components-library/src/common/Button/Button.tsx` has exactly **two** variants,
`primary` and `secondary`, and **no size variants** — every button is the one
default size (`h-control` height, `px-4`, `text-base` label).

**Pick one of the existing variants. Do not add a new one as part of a feature.**

If neither existing variant fits, that is a design decision the team makes
together, not a local one: write a proposal under `improve-proposals/` and get it
agreed *before* implementing it. A proposal for a new variant should cover what
it is for, which existing variant it replaces or sits beside, how it behaves
pressed/disabled/loading, its contrast against the surfaces it lands on, and
which existing call sites would move to it.

The same goes for sizes. They are a known gap, not an oversight, and they come
back the same way — as a proposal, with the padding/label/height decisions
written down — not as a `size` prop added in passing.

## Why

A button look is a system-wide promise: the same `h-control` height everywhere so
buttons and inputs line up, one border weight for actions and another for fields,
one primary call-to-action per view. Every extra variant is another thing design
QA has to check, contrast tooling has to be told about, and a screen-reader user
has to learn. Most calls for "one more variant" are really a call for a different
label, a different `className` at the call site, or `disabled`/`loading` — all of
which `Button` already supports.

## What enforces it

`Button.variants.web.test.tsx` pins the variant list to the approved two, checks
each one has its own Storybook story, and fails if a `size` prop reappears. Adding
a variant means updating that list in the same change as the proposal lands, so
the diff shows the list deliberately moving.

Reach for `className` / `labelClassName` at the call site before reaching for a
variant — but not to restate a height or a radius, which `h-control` and the
variant own (see `README.md`, "Architecture boundaries and known gotchas").
