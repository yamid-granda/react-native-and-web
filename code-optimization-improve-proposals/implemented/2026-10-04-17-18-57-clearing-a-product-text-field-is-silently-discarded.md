# Clearing a product's description or image is silently discarded, so the seller edit form lies about saving

## Problem / opportunity

`PATCH /my-store/products/{id}` cannot clear either of the two free-text fields
it accepts. A seller can delete a description or a product image in the edit
form, press Save, get a `200`, be redirected to their catalogue, and see the text
they just deleted still there — permanently, and publicly, on the storefront and
the product detail page.

This is not an inference from reading the client. Four independent places each
collapse one distinction, and the collapse survives all the way to the database:

### 1. The edit form turns "cleared" into "absent"

```ts
// components-library/src/business/ProductFormScreen/ProductFormScreen.tsx:196-202
return {
  title,
  description: fields.description.trim() || undefined,
  price,
  imageUrl: fields.imageUrl.trim() || undefined,
  stock,
}
```

`ProductFormValues` (`:21-27`) declares both as `description?: string` /
`imageUrl?: string`, and `|| undefined` means a blank field is *omitted from the
JSON body entirely* — `JSON.stringify` drops an `undefined` value. The form
renders every field on every submit, so on an edit an omitted field is never
"the seller did not touch it". It is always "the seller deleted it".

The type that carries this is `Partial<ProductFormValues>`:

```ts
// components-library/src/business/ProductFormScreen/ProductEditorScreen.tsx:19
update: (id: string, values: Partial<ProductFormValues>) => Promise<ProductData>
```

`Partial<>` is correct and it is the trap. It tells the caller that omitting a
field is safe — which is true — and it gives the caller no way to say *set it to
nothing*.

### 2. serde collapses `null` and absent

```rust
// api-rs/src/handlers/my_store.rs:34-46
#[derive(Deserialize, Default)]
pub struct UpdateProductRequest {
    #[serde(default)]
    description: Option<String>,
    …
    #[serde(rename = "imageUrl", default)]
    image_url: Option<String>,
    …
}
```

serde deserializes JSON `null` into `Option<T>` as `None`. So
`{"description": null}` and `{}` are the same request. There is no third state
to reach for.

### 3. The handler collapses whitespace too

```rust
// api-rs/src/handlers/my_store.rs:96 and :98, calling :169-171
description: trim_to_none(request.description),
image_url: trim_to_none(request.image_url),
…
fn trim_to_none(value: Option<String>) -> Option<String> {
    value.map(|value| value.trim().to_string()).filter(|value| !value.is_empty())
}
```

This is a fourth collapse, and it removes the last spelling a client could try:
even a deliberate `{"description": "   "}` becomes `None`.

### 4. `COALESCE` turns `None` into "leave the column alone"

```sql
-- api-rs/src/store/products.rs:238
UPDATE "Product" SET "title" = COALESCE($2, "title"), "description" = COALESCE($3, "description"), "price" = COALESCE($4, "price"), "imageUrl" = COALESCE($5, "imageUrl"), "stock" = COALESCE($6, "stock") WHERE "id" = $1 AND "ownerId" = $7
```

`COALESCE(NULL, "description")` returns the stored value. The patch succeeds, the
row is updated (`rows_affected() == 1`), the handler re-reads the row
(`store/products.rs:609-615`) and serialises the **old** description into a `200`.

**The complete set of requests that can clear the column is empty.** Not
`{"description": ""}`, not `{"description": "   "}`, not `{"description": null}`,
not omitting it. From neither app, nor from `curl`.

### 5. The server records the limit accurately, in a file the seller cannot reach

```rust
// api-rs/src/store/products.rs:233-237
/// `COALESCE($, column)` per field is what makes this a real PATCH: an absent
/// field leaves the stored value alone. There is no way to distinguish "absent"
/// from "explicitly null" this way, which is a deliberate limit — clearing an
/// image or a description is out of scope, and doing it properly needs a
/// per-field presence list in the request body.
```

That paragraph is **correct**, and it is the right diagnosis — it names the exact
fix. Three things are wrong with it as a piece of engineering:

1. **It is in the wrong repository.** It lives in Rust, on a SQL constant, and
   the only actor that triggers the bug is `ProductFormScreen.tsx` in a
   TypeScript package. Nothing in the TS tree mentions it.
2. **It is duplicated verbatim.** The same four sentences appear again at
   `store/products.rs:574-576`, inside `update_owned`, as a second doc comment on
   the call site. Two copies of one caveat, neither next to the code that has to
   honour it.
3. **It is not honoured at the boundary.** A documented API limit that the only
   client silently walks into is not a limit — it is a defect with a
   documentation-shaped excuse. The sentence says "out of scope"; nothing says
   the form already lets a seller try.

### 6. The asymmetry proves it is an oversight, not a design

`INSERT_PRODUCT` binds both columns straight through:

```rust
// api-rs/src/store/products.rs:227
INSERT INTO "Product" ("id", "title", "description", "price", "currency", "imageUrl", "stock", "createdAt", "ownerId") VALUES ($1, $2, $3, $4, 'USD', $5, $6, $7, $8)
```

and `CreateProductRequest` (`my_store.rs:21-30`) has
`#[serde(default)] description: Option<String>`. So **create can write a product
with no description at all** — `{"title":"Mug","price":8}` produces
`description = NULL`, and the migration declares the column nullable
(`20260926133034_create_product.up.sql:4`, `"imageUrl" TEXT` at `:7`).

Which means the reachable state space is one-way: *absent → present* works,
*present → absent* is unreachable. A seller can create a product with no
description, add one, and can then never remove it. There is no code path in the
repository — client, server, or SQL — that sets either column back to `NULL`.

### 7. Nothing in the repository can observe this

- **The E2E patch test never touches a text field.**
  `api-rs/tests/e2e_my_store.rs:170` `patching_then_deleting_is_visible_everywhere_it_matters`
  sends `json!({ "title": "Trail Camera v2", "price": 199.99 })` at `:177` and
  asserts `:186-187`. `description` and `imageUrl` are absent from every PATCH
  in the suite (`:177`, `:246`, `:392`).
- **The store contract suite does not cover patch semantics at all.**
  `api-rs/src/store/contract.rs` is invoked against both implementations —
  `store/memory.rs:385` (unit) and `tests/e2e_products.rs:19` (Docker) — and its
  only use of `update_owned` is `:147`,
  `update_owned(OTHER_OWNER_ID, &mine.id, ProductPatch::default())`, testing
  cross-owner invisibility. Not one assertion about what a patch does to a field.
- **`ProductPatch::is_empty` (`store/products.rs:67-75`) is still dead** outside
  its own two assertions (`:636-637`). It was already named as dead and scoped out
  by `2026-10-03-22-37-46-make-the-store-contract-executable.md:202` and `:405`.
  It is worth noticing *why* it matters now: `is_empty` is the only thing in the
  type that reasons about which fields were sent, and a patch that cannot
  distinguish absent from null has no business asking the question.
- **The in-memory double already matches production**
  (`store/memory.rs:336-350` is `if let Some(x) = patch.x { … }`, which is
  "leave alone" for `None`, exactly like `COALESCE`). So a contract assertion is
  writable today and will be **red on both implementations** until the semantics
  are decided — which is the correct place for it.

### Why this is the expensive kind of knowledge

The answer to "can a seller remove a product's image?" is spread across three
files in two languages, and the two halves each point the wrong way:

- `ProductFormScreen.tsx:198-200` returns `|| undefined`, which reads as "no value
  to send".
- `products.rs:233-237` says clearing is "out of scope".
- `my_store.rs:169-171` looks like input normalisation.
- `products.rs:238` is the actual reason, in SQL.

An agent asked to *"let sellers remove a product image"* edits
`ProductFormScreen.tsx:200` from `|| undefined` to `|| null`, runs
`pnpm typecheck` (green), runs `pnpm --filter @rnw/components-library test`
(green), runs `pnpm --filter @rnw/web-application test:e2e` (green), and the
change does **nothing** — `trim_to_none` and `COALESCE` both swallow the null,
and the API answers `200` with the old value. There is no check anywhere that
would have failed. That is the exact failure mode this repository has already
catalogued six times, and the same remedy applies: make the contradiction a test
failure instead of a comment.

The cost lands where `ARCHITECTURE.md` says the public surface is. A seller's
catalogue is public: `ProductDetailScreen.tsx:80-81` renders
`{product.description}` and `GET /stores/{id}` and `GET /products/{id}` both carry
it. A description a seller deleted is still what every shopper reads, indefinitely,
with no cache TTL involved — the data is simply wrong at rest.

## Proposed approach

Keep `PATCH` a `PATCH`. Keep every route, status code, response body and golden
fixture byte-identical. Change one thing: make *field presence* a value the
request can carry, on both sides of the wire.

### 1. One helper for "absent / null / a value"

In `api-rs/src/handlers/my_store.rs`, beside `trim_to_none` (`:169-171`):

```rust
/// Distinguishes the three states a JSON key can be in.
///
/// serde's plain `Option<T>` collapses the first two — `{"description": null}` and
/// `{}` both arrive as `None` — which is why a PATCH built on `Option<T>` cannot
/// clear a text field: there is no spelling that means "set it to nothing".
fn double_option<'de, D, T>(de: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{ … }
```

This is serde's standard `double_option` recipe, about twelve lines. It is not an
invention, and the file already owns wire-format concerns in a sibling module
(`api-rs/src/serde_js.rs`).

`UpdateProductRequest` (`:35-46`) becomes tri-state on the two text fields only:

```rust
#[serde(default, deserialize_with = "double_option")]
description: Option<Option<String>>,
#[serde(rename = "imageUrl", default, deserialize_with = "double_option")]
image_url: Option<Option<String>>,
```

`title`, `price` and `stock` stay `Option<T>`: `title` cannot be empty
(`validate_title` rejects it at `:135-137`), and the other two have no "empty"
state worth expressing. Say that in a comment so the asymmetry reads as a
decision.

`trim_to_none` is replaced by a tri-state mapper: `Some(s)` → `Some(Some(trimmed))`
when non-empty, `Some("")` / `Some("   ")` → `Some(None)` (clear), `None` → `None`
(untouched).

### 2. `ProductPatch` learns to say "set this to nothing"

`api-rs/src/store/products.rs:59-64` currently uses `Option<T>` for all five
fields, which is what forces `COALESCE`. Two shapes, and the reviewer should pick
rather than inherit:

- **(a) Preferred — a three-valued `Patch<T>`.**

  ```rust
  /// What a PATCH says about one field.
  ///
  /// `Unset` is "the key was absent — leave the column alone". `Set(None)` is
  /// `"key": null` — clear it. They are different operations and `Option<T>`
  /// cannot hold both, which is why `UPDATE_PRODUCT` needs `COALESCE` and why a
  /// seller could not delete a description.
  pub enum Patch<T> { Unset, Set(Option<T>) }
  ```

  The vocabulary is the point: `COALESCE($3, "description")` becomes
  `if patch.description.is_unset() { None } else { Some($3) }`, and the SQL site
  says what it means.

- **(b) Minimal — `Option<Option<T>>` on the two text fields only.** A smaller
  diff, but it leaks the JSON shape into the store trait and leaves the trait's
  own vocabulary undefined. If chosen, the trait doc at
  `store/products.rs:112-113` must state what `Some(None)` means, or the next
  reader has to derive it from SQL again.

Either way, `is_empty` (`:67-75`) either becomes "every field is `Unset`" — in
which case it is worth keeping and worth calling from the handler — or is
deleted with its two assertions. Do not leave it dead a second time.

### 3. One statement, no dynamic SQL

`COALESCE` cannot express "set to NULL", so `UPDATE_PRODUCT` (`:238`) has to
change. The reviewer should choose between:

- **(a) Preferred — one extra presence boolean per field, one static statement.**

  ```sql
  UPDATE "Product" SET
    "description" = CASE WHEN $8 THEN $3 ELSE "description" END,
    "imageUrl"   = CASE WHEN $9 THEN $5 ELSE "imageUrl" END,
    …
  WHERE "id" = $1 AND "ownerId" = $7
  ```

  Keeps one prepared statement, keeps `sqlx::query` with positional binds (the
  crate does not use the compile-time-checked macros here), and makes presence
  explicit at the SQL site.

- **(b) Build the `SET` list from the fields that are present.** Fewer moving
  parts in Rust, at the cost of a runtime-built SQL string. Defensible; say which
  was chosen. A third option — `jsonb_populate_record` over a `$patch` jsonb
  parameter — is the most elegant Postgres answer and the least readable, and is
  listed only so it is visibly considered rather than missed.

`title`/`price`/`stock` keep `COALESCE`; they have no `null` state.

### 4. The client has to be able to say "cleared"

Without this, step 1 is invisible: the form still omits the key.

`ProductFormScreen.tsx:196-202` submits `description` and `imageUrl` as trimmed
strings, `""` included, and `ProductFormValues` (`:21-27`) keeps both as
`description: string` / `imageUrl: string`. On a create, `""` is a no-op the
server already normalises away (`trim_to_none` on the way in). On an edit, `""`
becomes `Some(None)` and clears the column.

`useMyStoreMutations.update` (`useMyStoreMutations.ts:52`) and the four route
call sites pass the object straight through, so no change is needed there.
`ProductEditorScreen.tsx:19`'s `Partial<ProductFormValues>` should keep its
`Partial` — it is still correct for a caller that genuinely omits a field — and
gain a line saying that *the form itself never omits one*.

Add the caveat to the client too, in the place a maintainer of the form will read
it, and **delete the duplicated Rust comment at `:574-576`** rather than
rewriting it — one caveat, on the SQL, is enough once step 3 makes the limit
expressible.

### 5. The assertion that stops it coming back

`api-rs/src/store/contract.rs` is the right home and it already runs against both
implementations (`store/memory.rs:385`, `tests/e2e_products.rs:19`). Add, next to
whatever it asserts about `update_owned`'s ownership check (`:147`):

1. **A patch that sets a text field to null clears it**, and the returned product
   reports it cleared. Red on both implementations today. This is the whole
   finding in one assertion.
2. **A patch that omits the key leaves the stored value alone.** The other half of
   the tri-state, and the one that keeps `COALESCE`'s original intent intact.
3. **A patch whose fields are all `Unset` returns the current product unchanged** —
   this is what `is_empty` was for, and it gives `store/products.rs:636-637` a
   real caller-shaped assertion instead of a self-referential one.

`store/memory.rs:336-350` needs the same treatment as the SQL impl (its
`if let Some(x)` becomes a `Patch` match), which is the whole point of the suite:
the two implementations meet on a question neither answered before.

## Impact

**Correctness — the reason this is worth doing.** A seller can delete a
description or a product image and have the deletion actually happen. Today that
gesture is accepted, answered `200`, and discarded, and the stale text is what
every shopper reads on the storefront and the detail page, with no cache TTL
involved.

**Consistency.** The reachable state space becomes symmetric: `absent ↔ present ↔
absent` in both directions, the same way `create` already allows `absent` at
birth. One rule — *a text field on a PATCH is either left alone or set, and "set
to nothing" is a value* — stated once on the SQL and once on the form, instead of
a four-way `|| undefined` / `Option<T>` / `trim_to_none` / `COALESCE` chain that
nobody wrote as a chain.

**Testability.** `store/contract.rs` gains the first assertion anyone has ever
written about what a `ProductPatch` *does*, and it runs against both the SQL
store and the double. The E2E suite gains the case its own checklist asked for and
never wrote: `improve-proposals/2026-10-03-seller-storefronts-my-store.md:284`
specifies "PATCH it and assert `GET /products/{id}` reflects the change", and the
test that shipped (`e2e_my_store.rs:170-187`) only ever patched `title` and
`price`.

**Maintainability / AI-developer cost.** This is the point. Today the answer to
"why doesn't my edit save?" is four files in two languages and a SQL string, and
the fix a reasonable agent tries (`|| undefined` → `|| null`) is a green-build
no-op. After this, the form's submit values are the request, and
`store/contract.rs` fails if the two implementations ever stop agreeing about
what a patch means.

**Performance.** None, and none is claimed. One statement either way, five extra
bound booleans on a path that already binds seven parameters, and no change to
request counts, payloads or response bodies. `tests/parity.rs` must stay
byte-identical — no route body changes.

**What does not improve, stated plainly.**

- **The two `api.ts` / `client.ts` transport copies stay duplicated.** That is
  `code-optimization-improve-proposals/in-progress/2026-10-04-07-05-49-the-http-boundary-is-duplicated-and-untested.md`
  and this proposal changes no line of either file.
- **`MAX_TITLE_LENGTH` is a hand-mirrored constant in two languages**
  (`api-rs/src/store/products.rs:23` and
  `components-library/src/business/ProductFormScreen/ProductFormScreen.tsx:39`,
  both `200`). The server's `validate_title` (`my_store.rs:134-145`) is the
  authority and the client's copy at `:179-181` is a courtesy that can go stale
  with nothing to notice. That is a real second instance of the same class and it
  is **deliberately not fixed here** — it deserves its own proposal, because the
  right fix (one owner) crosses the language boundary this one does not.
- **`useProductLookup` and the snapshot-staleness story are untouched.** The
  cart/wishlist/rail already re-read live data; that is
  `implemented/2026-10-04-03-05-32-persisted-product-snapshots-have-no-owner.md`
  and it landed.
- **`ProductPatch` still cannot change a product's `currency` or `ownerId`**,
  correctly — those are not seller-editable. This proposal does not widen the
  editable set, only makes clearing an editable one possible.
- **The 404-not-403 rule, the `no-store` header and the invalidation order** at
  `my_store.rs:130-132` are unchanged and must stay that way.

## Risks / trade-offs

- **It changes a live SQL statement on the write path.** `UPDATE_PRODUCT` is the
  only statement that mutates a product, and it is exercised by
  `e2e_my_store.rs:170` and `:246`. Step 3(a) keeps it a single static statement
  precisely so the blast radius is five `CASE` expressions; step 3(b) introduces
  a runtime-built string and should be a separate decision. Do not combine 3(a)
  and 3(b) in one commit.
- **`Option<Option<T>>` is a shape people misread.** If step 2(b) is chosen, the
  first thing a reviewer asks is "which `None` is which". That is an argument for
  2(a)'s enum, and the trade is five extra lines in the enum plus a `From` impl.
  Whichever is taken, the doc comment on the type is not optional.
- **The client change is not optional and is not cosmetic.** If step 4 is skipped,
  steps 1-3 ship an expressible operation that nothing calls. That is strictly
  better than today (the API can now clear a field, so a future client can) but it
  does not close the bug, and the proposal should not be called done until step 4
  lands. Sequence 1-3 as one commit, 4 as the next.
- **Sending `""` where `undefined` went changes what a create sends.** Harmless
  today (`trim_to_none` normalises it away on the way in, and
  `CreateProductRequest.description` is `#[serde(default)]`), but it does mean the
  create body grows two empty strings. If that is objectionable, keep
  `ProductFormValues.description?: string` and have the *edit* path send `null`
  explicitly — at the cost of two shapes in one type. Pick one; say which.
- **It contradicts a written decision**, in the only sentence anyone wrote about
  this: `store/products.rs:236` calls clearing "out of scope". The argument is
  that the form already ships it. If a reviewer disagrees and wants the limit to
  stand, then the correct outcome is **not** to leave this as-is — it is to make
  the form refuse (disable the field, or reject a cleared submit with a message),
  so the API's limit and the UI's behaviour agree. Say which of the three endings
  was taken; all three are legitimate, silence is not.
- **Scope.** The `MAX_TITLE_LENGTH` mirror, `ProductPatch::is_empty`'s second
  death, the `Request`/`Response` body limit on `by-ids`, the
  `error.rs` `status()`/`body()` two-match drift, and the missing
  `Cache-Control` metric descriptions in `telemetry.rs` are all real and all
  separate. None of them belongs in this diff.

## Validation

1. **The premise, first and alone.** In a scratch branch, before any change:
   create a product **with** a description, then `PATCH` it four ways —
   `{"description": ""}`, `{"description": "   "}`, `{"description": null}`, and
   `{}` — and read `GET /products/{id}` after each. **Before the fix: the
   description is unchanged in all four cases.** If any of them clears it, the
   premise is wrong and this proposal should be rejected rather than reworked.
   The cheapest form of this is the E2E case in step 3.
2. `pnpm --filter @rnw/api-rs test` — the three new `store/contract.rs`
   assertions are green, and **every existing suite passes unchanged**, notably
   `store/products.rs`'s `an_empty_patch_changes_nothing` (`:635-638`) and the
   `store/memory.rs` contract run (`:385`). `store/memory.rs:336-350` changes
   shape, so the *double* is edited; the assertions are not.
3. **The behavioural regression, in `api-rs/tests/e2e_my_store.rs`** (needs
   Docker; the file already exists and no `package.json` script change is needed
   — `test:e2e` lists `--test e2e_my_store`):

   ```rust
   // red before the change, green after
   create a product with a description and an imageUrl
   PATCH {"description": null, "imageUrl": null}
   assert GET /products/{id} sends "description": null and "imageUrl": null
   // and the other half: an omitted key still leaves the value alone
   PATCH {"price": 12}
   assert the description is still null and the price moved
   ```

   This is the whole finding in two assertions.
4. **Negative checks, in a scratch branch**, because a test that cannot fail is
   worse than no test:
   - restore `description: Option<String>` on `UpdateProductRequest` (drop
     `double_option`) and confirm contract assertion 1 fails;
   - change `CASE WHEN $8 THEN $3 ELSE "description" END` back to
     `COALESCE($3, "description")` and confirm assertion 1 fails;
   - make `memory.rs` treat `Set(None)` as `Unset` and confirm assertion 1 fails
     on the double — this is the check that the suite is really comparing two
     implementations rather than asserting the same thing twice.
5. `pnpm --filter @rnw/api-rs test:e2e` — `tests/parity.rs` byte-compares
   committed goldens and none of them is a PATCH response, so it must pass
   untouched; that is the check that no response body moved. Then
   `e2e_my_store.rs`'s existing `patching_then_deleting_is_visible_everywhere_it_matters`
   (`:170`) and the cross-owner 404 at `:246`, which is the assertion most likely
   to notice a patch that deletes too much.
6. `pnpm --filter @rnw/components-library test` — the change to
   `ProductFormScreen.tsx` touches `parse()`, so
   `ProductFormScreen.web.test.tsx` and `ProductEditorScreen.web.test.tsx` are
   the gate. Add one assertion each: **a cleared description is submitted, not
   omitted** (`expect(update).toHaveBeenCalledWith(expect.objectContaining({ description: "" }))`).
   That is the client half of the finding and it is currently unwritable.
7. `pnpm --filter @rnw/web-application test` — 7 files, must pass **unchanged**;
   `my-store.test.tsx`'s create assertion at `:179-185` expects
   `description: undefined` / `imageUrl: undefined` in the submitted values and
   **will need updating** if step 4 sends `""`. That edit is the proof the client
   half landed, so make it deliberately rather than loosening the assertion.
8. `pnpm typecheck && pnpm lint`, and `pnpm --filter @rnw/api-rs lint`
   (`cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`) — the new
   `double_option` signature and the `Patch<T>` enum are both clippy-relevant, and
   the duplicate-comment deletion at `products.rs:574-576` is a `cargo fmt` diff.
9. `pnpm --filter @rnw/api-rs coverage` — the 80% line gate must still pass.
   `UPDATE_PRODUCT` stays one statement and `store/memory.rs`'s five `if let`
   arms become five `match` arms, so the denominator is roughly unchanged and the
   new contract assertions are covered.
10. `pnpm --filter @rnw/web-application test:e2e` — needs api-rs running and
    seeded. `e2e/my-store.spec.ts:68-75` exercises the edit flow, so it is the
    check that the real form still saves; extend it with "clear the description,
    save, assert it is gone on the storefront" if the suite's fixtures make that
    cheap.
11. **Not runnable here, and honestly so:** `pnpm --filter @rnw/mobile-application
    test:e2e` needs a native build and a simulator. `e2e/my-store.e2e.ts` has the
    edit leg and it is the only check that reaches the *native* form path. Because
    the change is in the shared `ProductFormScreen`, the components-library suite
    in step 6 is real evidence for the mobile form too — but say plainly that the
    Detox leg has not run.
12. Mechanical check, before and after, the same shape as the evidence above:
    ```bash
    grep -n "COALESCE\|CASE WHEN" api-rs/src/store/products.rs
    grep -n "trim_to_none\|double_option" api-rs/src/handlers/my_store.rs
    grep -n "|| undefined" components-library/src/business/ProductFormScreen/ProductFormScreen.tsx
    ```
    Success is not "zero hits". It is that every remaining `COALESCE` is on a
    field with no empty state (`title`, `price`, `stock`), that
    `products.rs:233-237` no longer says clearing is out of scope, and that the
    comment exists in **one** place rather than two.

## Related proposals

Read across all four lifecycle folders at the time of writing — `todo/` (1
entry: `2026-10-04-11-38-54-the-web-storage-fallback-is-written-but-never-read.md`),
`in-progress/` (4 entries), `implemented/` (8 entries) and `rejected/` (README
only) — plus `improve-proposals/`. **None claims this.**

- **`code-optimization-improve-proposals/implemented/2026-10-04-02-19-04-one-mutation-seam-for-every-seller-write.md`
  — the closest relative, and it is the reason this is cheap to verify.** It moved
  all four seller writes onto `useMyStoreMutations` and named the seam. It is
  entirely about *which* query keys a write retires; it never looks at what the
  PATCH body contains. Its step 4 routes `create`/`update` through the seam, which
  is precisely the path this bug lives on — so **this finding was reachable only
  after that proposal landed**, and its Validation step 3 ("with a `QueryClient` at
  the production `staleTime`… fire `useMyStoreMutations(...).update.mutate`") is
  the harness that can now assert a cleared field round-trips. Not superseded; not
  superseded *by* it either.
- **`code-optimization-improve-proposals/implemented/2026-10-04-03-05-32-persisted-product-snapshots-have-no-owner.md`
  — related, adjacent, different file.** Its finding 5 is that
  `Product.tsx:90` hand-builds a `ProductData` literal and silently drops
  `storeId`, because `ProductData`'s fields are all optional. That is the same
  underlying disease — *an optional field is not a tri-state* — one layer up, in a
  different file. It is implemented and closed; it did not touch
  `ProductFormScreen.tsx`, `my_store.rs` or `store/products.rs`, and its approach
  says explicitly that it keeps "all three stores, their storage keys" and adds a
  version field only conditionally (`:265-269`). **Neither supersedes the other.**
  If both are ever in flight, this one is the smaller diff.
- **`code-optimization-improve-proposals/implemented/2026-10-03-22-37-46-make-the-store-contract-executable.md`
  — the proposal that built the suite this one adds to, and the only document in
  the corpus that names `ProductPatch` at all.** Its step 3 created
  `store/contract.rs`; its item 3 enumerated the four store-semantics
  disagreements the suite should pin and **patch semantics is not among them**.
  Its Risks section (`:405`) and its Impact section (`:202`) both name
  `ProductPatch::is_empty` as dead and scope it out — this proposal keeps that
  observation and gives the method a purpose or deletes it, but claims nothing
  else from that document. Its `DelegatingStore` and `InMemoryStore`'s
  `fail_*`/`hang_*` switches already landed, which is why step 5's contract
  assertions are cheap to write today.
- **`code-optimization-improve-proposals/implemented/2026-10-03-22-34-46-one-read-path-for-the-product-lists.md`
  — unrelated surface, and it did touch this file.** Its finding 1 is the
  `products:detail:` key literal, fixed with `detail_key(id)`, and its step 4
  added `ProductsPageJson::from_page`. Neither touches `ProductPatch`,
  `UPDATE_PRODUCT` or `my_store::update`. No file conflict.
- **`code-optimization-improve-proposals/in-progress/2026-10-04-07-05-49-the-http-boundary-is-duplicated-and-untested.md`
  — unrelated and explicitly untouched.** It moves the two per-app `fetch`
  wrappers into one `components-library/src/api/transport.ts`. This proposal edits
  no line of `web-application/lib/api.ts` or
  `mobile-application/src/api/client.ts`. Its stated residual — that
  `mobile-application` has no unit test runner — is real and is not addressed here
  either; step 6 is the components-library half of that gap and no more.
- **The three other `in-progress/` entries** — `2026-10-04-05-04-58-the-design-tokens-have-no-owner.md`
  (CSS custom properties), `2026-10-04-06-16-26-the-load-shedder-fails-open-silently.md`
  (`middleware/rate_limit.rs`) and `2026-10-04-08-20-32-the-shedding-boundary-is-an-accident-of-route-order.md`
  (`app.rs`'s builder chain) — share no file with this proposal.
- **`code-optimization-improve-proposals/todo/2026-10-04-11-38-54-the-web-storage-fallback-is-written-but-never-read.md`
  — unrelated surface** (`components-library/src/utils/persistStorage.ts`). It is
  the same *failure class* — a comment describing a contract the code does not
  deliver — in a different repository layer, and it is the seventh instance in
  this repository rather than the first. It says so itself at `:215-227`. No file
  overlap; no ordering dependency.
- **`improve-proposals/2026-10-03-seller-storefronts-my-store.md` — the proposal
  that created the route and its e2e checklist, and the origin of the gap.** Its
  route table (`:102`) and its verification list (`:284-285`) specify PATCH and
  require that a PATCH be observable through `GET /products/{id}`; the test that
  shipped patches only `title` and `price`. It says nothing about clearing a
  field, and this proposal does not reopen its 404-not-403 rule (`:88`) or its
  transport decision (`:172`).