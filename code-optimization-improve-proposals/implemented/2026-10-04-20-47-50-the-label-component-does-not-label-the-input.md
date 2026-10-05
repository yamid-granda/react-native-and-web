# `Label`'s `htmlFor` labels the caption instead of the field, and eight form fields have no accessible name

## Problem / opportunity

`components-library` has a `Label` primitive whose single documented job is to
associate a caption with a form field. It does not do that. The association
prop is inert, and the string it does produce is attached to the wrong element.

### 1. The claim and the code

`components-library/src/common/Label/Label.tsx:10-15` documents the prop:

```ts
  /**
   * The `Input` this labels. Wired as `accessibilityLabel` on the field so a
   * screen reader announces something meaningful — the placeholder disappears
   * as soon as the user types, and "text field" alone tells them nothing.
   */
  htmlFor?: string
```

"On **the field**." The code puts it on the caption:

```tsx
// components-library/src/common/Label/Label.tsx:33-36
      // `accessibilityLabel` rather than `htmlFor`: RN has no label/for, and
      // react-native-web renders this Text, so the id has to travel as an
      // accessibility label for the association to survive on both platforms.
      accessibilityLabel={htmlFor ? `${children} label` : undefined}
```

The comment's *reasoning* is correct — RN has no `label`/`for` — and its
*conclusion* is where it goes wrong. An `accessibilityLabel` on a `Text` labels
that `Text`. The `TextInput` it is meant to name is a sibling three lines away
in the caller's JSX and receives nothing.

Two things follow, and only the first is obvious:

- **The `htmlFor` string is never matched against any field.** It is read for
  truthiness at `:36` and for nothing else. `Input.tsx:76-88` sets no `id` and
  no `nativeID`, and RN's `TextInput` consumes no `htmlFor`. The prop is a
  boolean wearing a string's clothes.
- **The string that is produced is `"<Field> label"`** — `"Email label"`,
  `"Title label"` — attached to the caption. Per name-from-content, an explicit
  `accessibilityLabel` overrides an element's own text, so the caption's
  accessible name becomes `Email label` rather than `Email`. That phrase appears
  nowhere on screen.

### 2. All eight call sites are unlabelled, and the pairing is already written down twice

`htmlFor` is passed at exactly eight places in non-test source, and **not one of
the eight sibling `<Input>`s carries an `accessibilityLabel`**:

| `Label` call site | paired `Input` | `accessibilityLabel` on the Input? |
| --- | --- | --- |
| `AuthScreen.tsx:109` | `AuthScreen.tsx:110-118` | **no** |
| `AuthScreen.tsx:122` | `AuthScreen.tsx:123-131` | **no** |
| `AuthScreen.tsx:136` | `AuthScreen.tsx:137-142` | **no** |
| `ProductFormScreen.tsx:86` | `:87-92` | **no** |
| `ProductFormScreen.tsx:96` | `:97-103` | **no** |
| `ProductFormScreen.tsx:108` | `:109-115` | **no** |
| `ProductFormScreen.tsx:118` | `:119-125` | **no** |
| `ProductFormScreen.tsx:130` | `:131-137` | **no** |

The association is not merely absent — it is expressed and then not connected.
In every one of the eight cases the `htmlFor` value and the sibling's
`inputTestID` are **the same string**:

```
// ProductFormScreen.tsx:86-88          AuthScreen.tsx:109-111
<Label htmlFor="product-title">         <Label htmlFor="auth-email">Email</Label>
<Input                                 <Input
  inputTestID="product-title"             inputTestID="auth-email"
```

The author paired them. Two independent props carry the same identifier and
nothing joins them, which is exactly why the defect is invisible: the code reads
as though the field were named.

### 3. The other half of the pair asserts a label that nobody supplies

```tsx
// components-library/src/common/Input/Input.tsx:55-57
    // accessible={false}: this Pressable is a mouse/touch convenience for
    // the TextInput it wraps, not a distinct control — screen readers
    // should land on the (labeled) TextInput itself, not stop here too.
```

The wrapper is correctly taken out of the accessibility tree on the stated
ground that it is "not a distinct control" and that the inner field is
**"(labeled)"**. It is not. `Input` has no `accessibilityLabel` default and no
knowledge that `Label` exists, so the wrapper is removed from the tree and
nothing is left to announce.

### 4. Three form-labelling strategies coexist, and the working one is the one `Label` is not in

| strategy | sites |
| --- | --- |
| `<Label htmlFor>` + unlabelled `Input` | the 8 above |
| `accessibilityLabel` on `Input`, **no `Label` rendered at all** | `ProductFilterControls.tsx:63` (`"Minimum price"`), `:74` (`"Maximum price"`); `SearchInput.tsx:8` defaults it, `:15` forwards it |
| `accessibilityLabel` written by hand | `Input.stories.tsx:13,68,75,83`; `Button.stories.tsx:52` |

`ProductFilterControls.tsx:56-78` is the clearest evidence that hand-labelling is
the understood workaround: its two price fields ship a `placeholder` and an
`accessibilityLabel` and **no visible caption at all**, because there is nothing
to caption them with. Every Storybook usage of `Input` also labels by hand.

### 5. The test suite works around the gap, and the one test named for the contract asserts something else

`Label.web.test.tsx:17-20`:

```tsx
  it("names the field it belongs to", () => {
    render(<Label htmlFor="auth-email">Email</Label>)
    expect(screen.getByText("Email")).toHaveAttribute("aria-label", "Email label")
  })
```

The test is **named** for the association and asserts the caption. `getByText`
returns the `Label`'s own `Text`; there is no field in that render at all. It is
green, it is the only test that mentions `htmlFor`, and it certifies a
caption-label.

`Input.web.test.tsx` corroborates by working around the same gap throughout. Nine
of its eleven tests hand `Input` the label that `Label` is supposed to provide,
purely so `getByLabelText` can resolve the field:

```tsx
// components-library/src/common/Input/Input.web.test.tsx:8-9
    render(<Input value="hello" onChangeText={vi.fn()} accessibilityLabel="Example" />)
    expect(screen.getByLabelText("Example")).toHaveValue("hello")
```

and the two that do not — `:68` and `:74` — fall back to `getByTestId`, because
they have no label to go on. A suite whose own idiom is "supply the label
yourself" is a suite that has established `Label` does not supply it.

### 6. The primitive that shipped is not the primitive that was specified

`improve-proposals/2026-10-03-seller-storefronts-my-store.md:156` asked for:

> Two form primitives do not exist yet and are needed: **a labelled field**, and a
> multiline text input

and `:240` lists `src/common/Label/Label.tsx` as the file that delivers it. What
landed is a caption with an inert prop on it. So this is not a scope change
since the proposal was written; the requirement was stated once, precisely, and
the implementation satisfies the letter of the file list rather than the
sentence.

### 7. Queued work inherits it

`improve-proposals/2026-09-29-checkout-shipping-details-form.md:40-44` builds a
shipping form "from the already-shared `common/Input/Input.tsx` for each field
(one `Input` per field, label as accessible placeholder/label text, error text
rendered below a field when `validate()` flags it)". "already-shared" is the
load-bearing word: the next form in this repository is specified against the
component that does not label, and it will add more unlabelled fields on top of
the existing eight.

### Why this is the expensive kind of knowledge

`.agents/rules/component-reuse.md` says nothing about accessibility — verified,
no hits — so there is no written standard to fall back on. The only statements
of intent are `Label.tsx:11-13` and `Input.tsx:55-57`, and **both are false in the
same direction**.

An agent asked to *"add a shipping-details form"* reads
`checkout-shipping-details-form.md:42`, reaches for `Label` + `Input`, pairs them
with `htmlFor`, writes a field, and produces an unlabelled control — with
`pnpm typecheck`, `pnpm lint` and `pnpm --filter @rnw/components-library test`
all green, and the one test that appears to cover the contract passing. This is
the repository's established failure class (a comment that outran its
implementation, seven times now) in the one part of `components-library/src/common/`
that no proposal has examined.

## Proposed approach

Keep `Label`, keep `Input`, keep `htmlFor` as the prop name, keep every field's
`inputTestID`, and keep all eight call sites' visible layout. Change one thing:
give the association an owner that can actually carry it.

### 1. New `components-library/src/common/FormField/FormField.tsx`

One component that owns caption + error + field, so the pairing cannot be
forgotten or misspelled:

```tsx
/**
 * A caption, its error, and the field it names — one owner for the association.
 *
 * `Label` alone cannot do this: it renders a `Text`, and an
 * `accessibilityLabel` on that `Text` labels the caption, not the `TextInput`
 * beside it. React Native has no `label`/`for`, so the name has to be handed to
 * the field itself. Composition is the only place that can do both.
 */
export function FormField({
  label, error, inputTestID, ...inputProps
}: { label: string; error?: string } & InputProps) {
  return (
    <View className="gap-1">
      <Label error={error}>{label}</Label>
      <Input inputTestID={inputTestID} accessibilityLabel={label} {...inputProps} />
    </View>
  )
}
```

`accessibilityLabel={label}` is derived **once**, from the same string that
renders the caption, so the two can never disagree. `{...inputProps}` goes last
so a caller can still override deliberately. Whether the caption needs
`accessibilityRole="text"` at all is a decision for review — see Risks.

`ProductFormScreen.tsx:85-137` and `AuthScreen.tsx:108-144` become eight
`FormField`s, each dropping one `htmlFor`/`inputTestID` duplicated string pair.
The `flex-row`/`flex-1` price-stock pair at `ProductFormScreen.tsx:106-127` keeps
its layout by composing two `FormField`s in the existing `View`.

### 2. `Label.tsx` — make the prop honest, or remove it

The choice belongs in review, not in the diff:

- **Preferred — `Label` loses `htmlFor`.** With `FormField` owning the
  association, `htmlFor` has no remaining caller, and deleting it removes the
  false comment at `:11-13` and the misleading one at `:33-35` instead of
  rewriting them. `Label.tsx:39`'s existing behaviour (error replaces the
  caption) is unchanged.
- **Minimal — keep `htmlFor` and correct both comments** to say plainly that it
  is a caller-supplied hint with no cross-element effect. Weaker: it leaves an
  inert prop and a third labelling strategy in place.

Either way the `Input.tsx:55-57` comment stops claiming the field is labeled,
or becomes true.

### 3. Give the same treatment to the two strategies `FormField` supersedes

- `ProductFilterControls.tsx:56-78` — replace the `placeholder` +
  `accessibilityLabel` pair with two captioned `FormField`s, which also gives
  those two fields the visible caption they currently lack.
- `SearchInput.tsx` — keep it; it is a wrapper whose only job is a default
  `accessibilityLabel`, and `FormField` does not subsume it. Say so in its doc
  comment so the next reader knows which of the two paths a new search field
  takes.

### 4. The two assertions that are currently impossible

In `FormField.web.test.tsx`, picked up by the existing glob
(`vitest.config.web.ts:44` globs `src/**/*.web.test.tsx`; `src/common/` is inside
`src/`):

1. **`getByLabelText("Email")` resolves to the `input`, not the caption.** This
   is the whole finding in one assertion, and it is unwritable today — which is
   why `Label.web.test.tsx:17` had to settle for asserting the caption.
2. **The caption and the field agree**, read separately: `getByText("Email")` is
   the caption and `getByLabelText("Email")` is the field, and they are distinct
   nodes. Without this, assertion 1 can pass with the label still on the caption.

Then in `Label.web.test.tsx`, if `htmlFor` survives step 2, replace the test
named `"names the field it belongs to"` with one that actually renders a field —
or delete it with the prop. **A test whose name asserts a contract its body does
not check should not survive this change**, whichever option is taken.

### 5. A parity check, in the discipline the repo already chose

`Button.centralization.test.ts` is the precedent: one test, a cross-cutting
invariant, an allowlist where each entry names its reason, plus a companion
assertion that no entry has gone stale (`:63-70`). The invariant here is "no
`Label` renders without a labelled sibling field". Render
`ProductFormScreen` and `AuthScreen` and assert that for every caption there is
a field carrying the same accessible name. It is one test, it needs no allowlist
once `FormField` owns the pairing, and it makes the eight-way divergence
structurally impossible to reintroduce.

## Impact

**Consistency.** Three coexisting form-labelling strategies become one. Eight
hand-paired call sites become eight `FormField`s, and the identifier string that
each field currently carries twice (`htmlFor` + `inputTestID`) is carried once.

**Correctness.** Eight form fields across the sign-in, sign-up and seller
product forms get an accessible name. Today a screen reader reaches the email,
password, store-name, title, description, price, stock and image-URL fields and
has nothing to announce but the control type — and, as the comment at
`Label.tsx:12-13` correctly says, the placeholder vanishes as soon as the user
types. The two price fields in `ProductFilterControls` additionally gain the
visible caption they lack.

**Testability.** Two assertions become writable that no test in the repository
can currently express, plus one cross-cutting parity check in an existing test
file. `Label.web.test.tsx:17` stops being a test whose name contradicts its body.

**Maintainability / AI-developer cost — the point of this exercise.** The
question "is this form field labelled?" currently has the answer *no*, stated
in two comments that say *yes*, guarded by a test named for the contract that
checks something else, in a module `.agents/rules/component-reuse.md` never
mentions. That is four pieces of written knowledge pointing three different ways,
and it is exactly the shape that costs an agent a full read of two files to
discover. `FormField` makes the answer structural instead.

**Performance.** None, and none is claimed. One extra component boundary per
field, no new render-path work, no change to layout, styling or test IDs.

**What does not improve, stated plainly.**

- **`native` still renders no accessible caption association.** `accessibilityLabel`
  on a `TextInput` is the platform's own mechanism and is out of this proposal's
  reach; this fixes web, and native gets the label RN already supports on the
  field rather than the one it was getting on the caption.
- **The queued shipping form is not written by this.** It inherits a working
  primitive instead of a broken one, which is a smaller win than landing the form
  correctly.
- **`Label` may be left with `htmlFor`** if step 2's minimal option is taken, in
  which case the inert prop survives and only its documentation improves.
- **`ProductFilterControls` keeps its own `Input` usage for the sort control**
  (`ProductFilterControls.tsx:50`, an `accessibilityLabel` on a button-like
  control) — that is not a labelled-field case.
- **`IconBase`, `Drawer`, `ProductCard` and `SearchInput` are untouched.** The
  `ProductCard` case — `accessibilityRole="button"` at `:57` with no
  `accessibilityLabel`, name taken from inner `Text` — is a real and separate
  question about whether a composite control needs an explicit name, and it is
  deliberately not claimed here.
- **Nothing in `api-rs`, `web-application` or `mobile-application` changes**, so
  no Rust check and no route test is evidence either way. `mobile-application`
  still has no unit test runner, so the native leg of this change is `tsc` and
  Detox only — see Validation.

## Risks / trade-offs

- **It deletes a prop from a shared component.** `htmlFor` is part of
  `LabelProps` and is exported through `components-library/src/index.ts`. If any
  consumer outside this repository renders `@rnw/components-library`, removing it
  is a breaking type change. **Check the barrel export and say which option was
  taken**; the minimal option exists precisely so this decision can be deferred,
  and it should be recorded rather than assumed.
- **`accessibilityRole="text"` on the caption is questionable** and this proposal
  surfaces rather than settles it. `Label.tsx:32` is the only non-`button` role
  in the library, and `role="text"` is not a role assistive technology is
  required to honour; combined with an explicit `aria-label` on a non-interactive
  element, the current markup may be ignored outright or read as
  "Email label". With `FormField` naming the field directly, the caption no longer
  needs to carry an accessibility attribute at all. **Deciding to drop both
  `:32` and `:36` is defensible and is the recommended end state** — but it is a
  behaviour change on a shared primitive, so it must be made deliberately and
  named in the commit, not slipped in.
- **`FormField` fixes the pairing but not the ids.** `inputTestID` becomes
  redundant with the derived label for test purposes; keeping both is correct
  (one is for tests, one is for assistive technology) and the proposal says so
  rather than collapsing them, because collapsing them would break
  `web-application/e2e/my-store.spec.ts:102-111` and `ProductFormScreen.web.test.tsx`.
- **`FormField` is a new component in a package whose rule is "route files stay
  thin, shared UI lives in `components-library`"** — so it is on the right side
  of `.agents/rules/component-reuse.md`. But it composes two existing primitives
  and adds no new visual element, which is the test `ProductCard`/`MainNavItem`
  set in
  `implemented/2026-10-03-23-50-00-one-body-behind-the-platform-splits.md`: it
  earns its file because it removes a duplication the shared bodies could not.
- **A file-adjacency conflict with an in-flight proposal, and it is real.**
  `in-progress/2026-10-04-17-18-57-clearing-a-product-text-field-is-silently-discarded.md`
  edits `ProductFormScreen.tsx` (`:196-202`, and `:39`/`:179-181`). This
  proposal edits `ProductFormScreen.tsx:85-137`. Different regions, one file, and
  both will touch its imports. **Land this one first** — it is a shared primitive
  plus a mechanical call-site rewrite, and the in-flight proposal's Validation
  step 6 (`ProductFormScreen.web.test.tsx` / `ProductEditorScreen.web.test.tsx`)
  is the gate either way. If the in-flight one lands first, apply this on that
  branch.
- **No assistive technology is available to verify the fix.** Every assertion
  here is about markup (`getByLabelText` resolving to an `input`), which is the
  right level for an automated check and is *not* the same as hearing it work.
  Say that plainly in the PR rather than claiming the a11y defect is closed.
- **Scope.** The test-harness duplication across the 11 test files that pass
  `accessibilityLabel="Example"` by hand is a symptom of this defect and is
  deliberately **not** fixed here: those tests must keep labelling their own
  fields until `FormField` is adopted, and consolidating them is
  `implemented/2026-10-04-01-10-39-one-owner-for-the-web-resolution-contract.md`'s
  deferred harness work, not this diff. The `ProductCard` composite-control
  naming question, and `api-rs`'s discarded `describe_counter!` at
  `telemetry.rs:70` (a real and separate finding — a `metrics` description
  dispatched to the no-op recorder before `install_recorder()` at `:75`, so the
  `# HELP` line never reaches `/metrics`), are both real and both excluded.

## Validation

1. **The premise, first and alone.** Before changing anything: in a scratch
   branch, add to `Label.web.test.tsx` the assertion the contract implies —
   `render(<><Label htmlFor="x">Email</Label><Input inputTestID="x" … /></>)`
   then `expect(screen.getByLabelText("Email")).toBe(screen.getByTestId("x"))`.
   **Before the fix this must fail**, because no node carries the name `Email`.
   If it passes, the premise is wrong and this proposal should be rejected
   rather than reworked. This is the cheapest form of the check and it should be
   the first thing anyone does.
2. `pnpm --filter @rnw/components-library test` — the new
   `FormField.web.test.tsx` (both assertions from step 4 of the approach) plus
   the existing 39 files must pass. **`Label.web.test.tsx` and
   `Input.web.test.tsx` must both be edited deliberately and visibly**, not
   quietly: `Label.web.test.tsx:17` is the test that has to change, and if
   `Input.web.test.tsx` needed no edit at all, `FormField` was not adopted by the
   screens. Say which files changed.
3. **Negative checks, in a scratch branch**, because a test that cannot fail is
   worse than no test:
   - drop `accessibilityLabel={label}` from `FormField` and confirm assertion 1
     fails;
   - move the label onto the `Label` (the current `Label.tsx:36` behaviour) and
     confirm assertion 1 fails and assertion 2's two nodes collapse into one.
4. `pnpm --filter @rnw/web-application test` — 7 files in `tests/`,
   `my-store.test.tsx` the important one. The create/edit assertions query
   `product-title`, `product-price` and `product-stock` (`e2e/my-store.spec.ts`
   at `:102-111` uses the same three), so the `inputTestID` values must survive
   unchanged. **If any test needed a selector loosened to pass, the testIDs
   moved and that is a regression** — make it deliberate or undo it.
5. `pnpm typecheck && pnpm lint`. `LabelProps` may lose a member,
   `components-library/src/index.ts` gains `FormField`, and eight call sites in
   two files change shape — so this is the cheap check that no route or screen
   kept a dangling `htmlFor`.
6. `pnpm --filter @rnw/components-library build-storybook` — `Label.stories.tsx`
   and `Input.stories.tsx` both render through Vite and resolve the same modules
   the tests do, so this is the check that nothing in the change depends on
   resolution the bundlers do not share. If step 2 removes `htmlFor`,
   `Label.stories.tsx` and `Input.stories.tsx:40` are the files that must change.
7. **Mechanical, before and after** — the same shape as the evidence above:
   ```bash
   grep -rn 'htmlFor' --include='*.tsx' --include='*.ts' components-library/src
   grep -rn 'accessibilityLabel' --include='*.tsx' components-library/src/business
   ```
   Success is **not** "zero hits". It is that `htmlFor` has no remaining caller
   outside its own definition, and that every `accessibilityLabel` in
   `business/` is either derived inside a `FormField` or belongs to a control
   that is not a labelled field (`ProductDetailScreen.tsx:72`,
   `StoreScreen.tsx:86,94`, the two remove buttons).
8. `pnpm --filter @rnw/web-application test:e2e` — `e2e/my-store.spec.ts:68-75`
   drives the real edit form, so it is the check that the eight rewritten
   call sites still render and submit. Needs api-rs running and seeded. It asserts
   by `testID`, not by accessible name, so it is a regression net and **not**
   evidence for the a11y fix.
9. **Not runnable here, and honestly so:** `pnpm --filter @rnw/mobile-application
   test:e2e` needs a native build and a simulator. The `ProductCard`/`MainNavItem`
   split in
   `implemented/2026-10-03-23-50-00-one-body-behind-the-platform-splits.md`
   established the same limit — a native component's rendered output is only
   reachable by Detox. Because `FormField` lives in the shared package and the
   components-library suite in step 2 is real evidence for both platforms, this
   is acceptable — but say plainly that the native leg has not run.

## Related proposals

Read across all four lifecycle folders at the time of writing — `todo/` (1),
`in-progress/` (2), `implemented/` (13), `rejected/` (README only) — plus
`improve-proposals/` and its `implemented/`. **Nothing claims this.**

- **Novelty evidence.** `grep -rin "htmlFor|accessibilityLabel|accessibility|aria-|screen reader|\bLabel\b|a11y"` across `code-optimization-improve-proposals/` and `improve-proposals/` returns hits in 11 documents; **every one is either a Prometheus metric label or the word "label" in prose**, and none concerns form labelling. `Label.tsx` and `Input.tsx` are named by exactly one document, as the *output* of a different proposal
  (below), never as a subject.
- **`improve-proposals/2026-10-03-seller-storefronts-my-store.md` — the origin, related, not superseded, and this is the gap in its deliverable.** Its `:156` specifies "Two form primitives do not exist yet and are needed: **a labelled field**, and a multiline text input", and `:240` lists `src/common/Label/Label.tsx` as the file that delivers it. The multiline half landed and works (`Input.tsx:71`, `Input.web.test.tsx:73-80`); the labelled half shipped as an inert prop. This proposal does not reopen anything else in it — the transport duplication stays (`:172`), the generation counter stays, the 404-not-403 rule stays. **The requirement was stated correctly and the implementation missed it; this proposal closes the miss rather than restating the requirement.**
- **`improve-proposals/2026-09-29-checkout-shipping-details-form.md` — unrelated file, and it is why this is worth doing now.** Its `:40-44` builds a new form from "the already-shared `common/Input/Input.tsx`", one `Input` per field. It will add more unlabelled fields unless the primitive is fixed first. No file overlap; ordering only. **Land this before that one.**
- **`in-progress/2026-10-04-17-18-57-clearing-a-product-text-field-is-silently-discarded.md` — one-file adjacency, and it must be sequenced.** It edits `ProductFormScreen.tsx:196-202` (submit values) and `:39`/`:179-181`; this edits `ProductFormScreen.tsx:85-137`. Different regions. Its step 4 changes `ProductFormValues.description` to `string` and keeps `htmlFor` untouched; its Validation step 6 gates on `ProductFormScreen.web.test.tsx` and `ProductEditorScreen.web.test.tsx`, which this proposal also edits. **This one first**; if that one lands first, apply this on its branch. It shares no file with the other in-flight proposal.
- **`in-progress/2026-10-04-17-42-28-the-wire-contract-goldens-have-an-unowned-generator.md` — unrelated surface** (`api-rs/tests/fixtures/`, `tests/parity.rs`, `generate_goldens.py`). No file overlap.
- **`todo/2026-10-04-20-11-10-the-list-tiebreaker-depends-on-the-databases-collation.md` — unrelated surface** (`api-rs` migrations, `store/products.rs`, `store/memory.rs`, `store/contract.rs`). No overlap.
- **`implemented/2026-10-03-23-50-00-one-body-behind-the-platform-splits.md` — related, not superseded; the structural precedent and the test precedent.** Its step 1 and step 2 extract a shared body behind two platform adapters for the same reason this proposal composes instead of duplicating, and its finding 3 establishes the allowlist-plus-companion-assertion discipline that step 5 of the approach reuses. It cites `accessibilityLabel` only as a prop the `Product` adapters pass (`Product.tsx:28`, `Product.web.tsx:23`), and explicitly scopes out everything else — the 13-line icon smoke tests and the vitest harness duplication. **Its `Button.centralization.test.ts` is the file to copy, and `ProductCard`'s composite-control naming is its territory, not this one's.**
- **`implemented/2026-10-04-01-10-39-one-owner-for-the-web-resolution-contract.md` — unrelated surface** (bundler/test resolution), and its deferred scope note (`:324-330`) names the per-file test-harness duplication. That duplication's *symptom* — 11 test files hand-labelling their own fields — disappears only if `FormField` is adopted. It is named here as excluded scope, not claimed.
- **`implemented/2026-10-04-05-04-58-the-design-tokens-have-no-owner.md` — related only in method.** Its `tokens.parity.test.ts` is the same "make the contradiction a test failure instead of a comment" remedy this proposal reaches for, and its §"What does not improve" already declines to enforce anything about accessibility. Its **eight `describe_*` / allowlist assertions** are the closest existing template for step 5 here.
- **`implemented/2026-10-04-11-38-54-the-web-storage-fallback-is-written-but-never-read.md` — the seventh instance of this failure class, and the one that names the count.** Its §"Why this is the expensive kind of knowledge" enumerates six prior instances, each with a proposal, and states the common remedy. This is the seventh: a component whose comment states a contract its code does not deliver, guarded by a test named for that contract. Its remedy shape — make the contradiction a test failure — is what step 4 and step 5 do. Different module (`common/Label`, `common/Input`); no file overlap.
- **`implemented/2026-10-04-07-05-49-the-http-boundary-is-duplicated-and-untested.md`, `implemented/2026-10-04-02-19-04-one-mutation-seam-for-every-seller-write.md`, `implemented/2026-10-04-03-05-32-persisted-product-snapshots-have-no-owner.md`, `implemented/2026-10-04-01-10-39-one-owner-for-the-web-resolution-contract.md`'s sibling `implemented/2026-10-03-22-15-47-move-seller-route-wiring-into-components-library.md`, `implemented/2026-10-03-22-34-46-one-read-path-for-the-product-lists.md`, `implemented/2026-10-03-22-37-46-make-the-store-contract-executable.md`, `implemented/2026-10-04-04-06-14-the-session-table-has-no-reaper.md`, `implemented/2026-10-04-06-16-26-the-load-shedder-fails-open-silently.md`, `implemented/2026-10-04-08-20-32-the-shedding-boundary-is-an-accident-of-route-order.md` — unrelated surfaces** (transport, react-query cache, persisted stores, bundler config, per-app routes, api-rs read paths, store traits, the `Session` table, server middleware). None touches `common/Label/`, `common/Input/`, or any form screen's field labelling.
- **Nothing is superseded.** No proposal in any folder changes `Label`, `Input`, `FormField`, or any `accessibilityLabel`.