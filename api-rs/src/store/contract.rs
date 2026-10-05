//! Assertions any `ProductStore`, `UserStore` and `SessionStore` must satisfy.
//!
//! The compiler already checks that each implementation has the right *shape*.
//! What nothing checked was that the two implementations meant the same thing by
//! it — and a unit test written against the in-memory double can describe
//! behaviour the service does not have, which is the failure mode a second
//! implementation invites.
//!
//! One suite, two implementations: [`assert_store_contract`] runs under
//! `cargo test --lib` against [`super::InMemoryStore`], and again under
//! `test:e2e` against [`super::SqlProductStore`]. A disagreement becomes a red
//! build instead of something a reviewer has to notice.
//!
//! Every assertion here is one both implementations should still hold in two
//! years. An assertion that pinned today's behaviour of either one would make
//! the bug permanent, which is the reason this suite is small.

use std::future::Future;

use super::products::{NewProduct, Patch, ProductPatch, StoreError, PAGE_SIZE};
use super::MarketplaceStore;

/// The sellers the suite registers. Deliberately unlike the e2e fixtures, so a
/// database that already holds `prod-owned-1` and its seller is untouched.
const OWNER_ID: &str = "usr_store_contract";
const OWNER_EMAIL: &str = "store-contract@rnw.test";
const OWNER_STORE_NAME: &str = "Contract Shop";
const OTHER_OWNER_ID: &str = "usr_store_contract_other";
const OTHER_OWNER_EMAIL: &str = "store-contract-other@rnw.test";
const OTHER_STORE_NAME: &str = "Other Contract Shop";
const RENAMED_STORE_NAME: &str = "Contract Shop Renamed";
/// Its own seller, so the session-lifecycle counts below are exact rather than
/// inherited from whichever assertion happened to run before. Registered by the
/// assertion itself: the database is per-test, and the double starts empty.
const LIFECYCLE_OWNER_ID: &str = "usr_store_contract_lifecycle";
const LIFECYCLE_OWNER_EMAIL: &str = "store-contract-lifecycle@rnw.test";
const LIFECYCLE_OWNER_STORE_NAME: &str = "Lifecycle Contract Shop";
/// The search assertion's own seller, for the reason the lifecycle one has: its
/// rows have to be identifiable so "this search returns exactly my three rows"
/// stays true whatever the harness has seeded.
const SEARCH_OWNER_ID: &str = "usr_store_contract_search";
const SEARCH_OWNER_EMAIL: &str = "store-contract-search@rnw.test";
const SEARCH_OWNER_STORE_NAME: &str = "Search Contract Shop";

/// Run every store-layer assertion against `store`.
///
/// `rename_seller` is the one thing the suite cannot do through the traits: no
/// store has a method for renaming a seller, so a product's store name is
/// joined from the owner's row rather than copied at write time — which is
/// precisely the invariant being tested, and precisely the one that cannot be
/// reached without an out-of-band edit. Each harness supplies that edit: SQL for
/// Postgres, the map behind it for the double.
pub async fn assert_store_contract<S, F, Fut>(store: &S, rename_seller: F)
where
    S: MarketplaceStore + ?Sized,
    F: FnOnce(&str, &str) -> Fut,
    Fut: Future<Output = ()>,
{
    // `ping` is a real query, not a constant. Asserted here because every other
    // assertion below would pass against a store that cannot fail anything.
    store.ping().await.expect("ping answers");

    // `Product.ownerId` references `"User"`, so a product can only exist for a
    // seller that is really registered. The double has no such constraint, so
    // registering first is what lets one sequence of assertions mean the same
    // thing to both.
    register_the_contract_sellers(store).await;

    listing_windows_state_one_answer(store).await;
    a_cross_owner_row_is_invisible_not_forbidden(store).await;
    a_patch_distinguishes_absent_from_cleared(store).await;
    a_store_name_is_the_sellers_current_one(store, rename_seller).await;
    a_refused_registration_changes_nothing(store).await;
    expiry_is_folded_into_the_session_lookup(store).await;
    expired_sessions_leave_the_table_and_live_ones_are_enumerable(store).await;
    // Last: it writes the most rows of any assertion here, and the ones above
    // count a seller's products exactly.
    a_search_narrows_the_listing_and_the_total_together(store).await;
}

async fn register_the_contract_sellers<S: MarketplaceStore + ?Sized>(store: &S) {
    store
        .create_user(new_user(OWNER_ID, OWNER_EMAIL, OWNER_STORE_NAME))
        .await
        .expect("register the contract's seller");
    store
        .create_user(new_user(OTHER_OWNER_ID, OTHER_OWNER_EMAIL, OTHER_STORE_NAME))
        .await
        .expect("register the second seller");
}

/// `offset = 0`, an offset past the end, `limit = 0`, and a negative window.
/// Production binds these straight into `LIMIT`/`OFFSET`, so it refuses the
/// negative ones; a double that clamps instead would return a page the database
/// never produces, and a test asserting against it would be asserting fiction.
async fn listing_windows_state_one_answer<S: MarketplaceStore + ?Sized>(store: &S) {
    let first_page = store.list_page(0, PAGE_SIZE, None).await.expect("first page");
    assert!(!first_page.is_empty(), "the harness must seed at least one product");

    let whole = store.list_page(0, i64::MAX, None).await.expect("the whole catalogue");
    assert_eq!(
        first_page.first().map(|product| product.id.as_str()),
        whole.first().map(|product| product.id.as_str()),
        "offset 0 is the first row, not a page of its own"
    );

    let total = store.count(None).await.expect("count the catalogue");
    assert_eq!(total, whole.len() as i64, "the total is the whole catalogue");
    assert!(
        store.list_page(total, PAGE_SIZE, None).await.expect("offset past the end").is_empty(),
        "an offset past the last row is an empty page"
    );
    assert!(
        store
            .list_page_for_owner(OWNER_ID, 0, PAGE_SIZE)
            .await
            .expect("an owner with no rows")
            .is_empty(),
        "an unknown owner has no rows"
    );

    assert!(
        store.list_page(0, 0, None).await.expect("limit 0").is_empty(),
        "limit 0 is an empty page"
    );
    assert_eq!(
        store.count_for_owner(OWNER_ID).await.expect("count a seller with nothing"),
        0,
        "a registered seller with no products counts zero"
    );

    assert!(
        store.list_page(-1, PAGE_SIZE, None).await.is_err(),
        "a negative offset is refused, not clamped to page one"
    );
    assert!(
        store.list_page(0, -1, None).await.is_err(),
        "a negative limit is refused, not read as unlimited"
    );
}

/// A search narrows the rows *and* the count that describes them, matches on
/// the description as well as the title, and reads `%` and `_` as themselves.
///
/// The count half is the assertion that catches the bug this search exists for.
/// If `count` ignored the term, a page filtered down to 1 of 40,000 rows would
/// still report `hasNextPage: true` — promising pages that can never arrive.
///
/// Own products, so every assertion is about rows this function wrote. The
/// catalogue already holds the harness's fixtures, and an assertion like "a
/// search for `%` returns nothing" would otherwise be a claim about someone
/// else's seed data.
///
/// Terms are ASCII on purpose: `ILIKE` folds case using the database's collation
/// and the double uses Rust's `to_lowercase`, and the two agree on ASCII without
/// the suite depending on a collation neither harness may have configured.
async fn a_search_narrows_the_listing_and_the_total_together<S: MarketplaceStore + ?Sized>(
    store: &S,
) {
    store
        .create_user(new_user(SEARCH_OWNER_ID, SEARCH_OWNER_EMAIL, SEARCH_OWNER_STORE_NAME))
        .await
        .expect("register the search suite's seller");

    // Three rows, so a search has something to exclude and the terms below
    // cannot all land on the same row.
    store
        .create(SEARCH_OWNER_ID, new_product("Baby Blouse"))
        .await
        .expect("create a row matched by title");
    store
        .create(SEARCH_OWNER_ID, new_product("Winter Hat"))
        .await
        .expect("create a row matched by description only");
    store
        .create(
            SEARCH_OWNER_ID,
            NewProduct {
                description: Some("Kept warm in a pinch.".to_string()),
                ..new_product("Cap")
            },
        )
        .await
        .expect("create a described row");

    assert_eq!(
        own_titles(store, Some("blouse")).await,
        ["Baby Blouse"],
        "a title search finds the row and excludes the two it does not name"
    );
    assert_eq!(
        own_titles(store, Some("BABY")).await,
        ["Baby Blouse"],
        "a title search ignores case"
    );
    assert_eq!(
        own_titles(store, Some("pinch")).await,
        ["Cap"],
        "the description is searched too, and the term need not appear in the title"
    );
    assert_eq!(
        own_titles(store, Some("winter")).await,
        ["Winter Hat"],
        "a term present in both a title and a description resolves to one row"
    );

    // The total a filtered page reports has to be the filtered one, or
    // `hasNextPage` describes rows that will never arrive.
    assert_eq!(
        store.count(Some("blouse")).await.expect("the filtered total"),
        1,
        "the count follows the same filter as the listing"
    );
    assert_eq!(
        store.count(Some("a term that matches nothing at all")).await.expect("count nothing"),
        0,
        "a term nothing matches counts zero, so `hasNextPage` is false"
    );

    // Nothing matching is an empty page, never an error and never the whole
    // catalogue. The clients' "no products match" state is built on this.
    assert!(
        store
            .list_page(0, PAGE_SIZE, Some("a term that matches nothing at all"))
            .await
            .expect("a term nothing matches")
            .is_empty(),
        "a term nothing matches is an empty page"
    );

    // `%`, `_` and `\` are ordinary characters in a product name, but `ILIKE`
    // reads the first two as wildcards and treats a bare `\` as an escape. A
    // shopper searching `50%` must get discounts, not every row with a `50` in
    // it — and this suite runs against the double too, so it catches an
    // implementation that escapes in only one of them.
    for (title, term) in
        [("50% off", "50%"), ("Large_Widget", "Large_"), (r"Back\slash", r"Back\slash")]
    {
        store
            .create(SEARCH_OWNER_ID, new_product(title))
            .await
            .expect("create a row with a LIKE metacharacter in its title");
        assert_eq!(
            own_titles(store, Some(term)).await,
            [title],
            "`{term}` is matched literally, not as a pattern"
        );
    }
    // On its own a metacharacter is still just a character: it finds the one row
    // that literally contains it, and not the whole catalogue. This is the
    // assertion that fails without escaping — `%` as a wildcard matches every
    // row, and `_` matches anything with a character in it.
    for (wildcard, expected) in [("%", "50% off"), ("_", "Large_Widget")] {
        assert_eq!(
            own_titles(store, Some(wildcard)).await,
            [expected],
            "`{wildcard}` alone finds only the row that literally contains it, not every row"
        );
    }
}

/// Every row `term` matches, narrowed to the search suite's own products.
///
/// Narrowed because the catalogue already holds the harness's fixtures: these
/// assertions are about what this suite wrote, so an unrelated seeded product
/// that happens to match a term cannot make them fail — or, worse, pass for the
/// wrong reason.
async fn own_titles<S: MarketplaceStore + ?Sized>(store: &S, term: Option<&str>) -> Vec<String> {
    store
        .list_page(0, i64::MAX, term)
        .await
        .unwrap_or_else(|error| panic!("search {term:?} failed: {error}"))
        .into_iter()
        .filter(|product| product.owner_id.as_deref() == Some(SEARCH_OWNER_ID))
        .map(|product| product.title)
        .collect()
}

/// `None` for another owner's row, not a 403: a forbidden answer would confirm
/// the id exists on a public catalogue. Asserted for the double for a long time;
/// this is the first time it is asserted against the queries that serve it.
async fn a_cross_owner_row_is_invisible_not_forbidden<S: MarketplaceStore + ?Sized>(store: &S) {
    let mine = store.create(OWNER_ID, new_product("Contract Mug")).await.expect("create");
    let theirs = store.create(OTHER_OWNER_ID, new_product("Not Yours")).await.expect("create");

    assert!(
        store.find_owned_by_id(OTHER_OWNER_ID, &mine.id).await.expect("cross-owner read").is_none(),
        "another owner's row reads as absent"
    );
    assert!(
        store.find_owned_by_id(OWNER_ID, &mine.id).await.expect("own read").is_some(),
        "and as present to its owner"
    );
    assert!(store.find_by_id(&mine.id).await.expect("public read").is_some());
    assert!(
        store
            .update_owned(OTHER_OWNER_ID, &mine.id, ProductPatch::default())
            .await
            .expect("cross-owner update")
            .is_none(),
        "another owner cannot patch it"
    );
    assert!(
        !store.delete_owned(OTHER_OWNER_ID, &mine.id).await.expect("cross-owner delete"),
        "another owner cannot delete it"
    );
    assert_eq!(
        store.count_for_owner(OTHER_OWNER_ID).await.expect("count"),
        1,
        "they still have theirs"
    );
    assert_eq!(store.count_for_owner(OWNER_ID).await.expect("count"), 1);
    assert!(store.find_by_id(&theirs.id).await.expect("public read").is_some());
}

/// What a `PATCH` says about a field, which nothing in the repository asserted
/// before.
///
/// A seller can delete a description or an image. That gesture was accepted with
/// a `200` and discarded, and the stale text is what every shopper reads — so the
/// three states below are the whole finding in one function. `COALESCE($, column)`
/// cannot express them: an absent key and a `null` key both bind `NULL`, and both
/// answer with the stored value. The double's `if let Some(x)` agreed with that,
/// which is exactly why neither implementation was wrong on its own terms and the
/// pair of them was still wrong.
///
/// Held against both implementations, so a `Patch` that grows a fourth state, or a
/// SQL site that forgets its presence flag, is a red build rather than a form
/// that quietly stops saving.
async fn a_patch_distinguishes_absent_from_cleared<S: MarketplaceStore + ?Sized>(store: &S) {
    let created = store.create(OWNER_ID, text_product("Patchable")).await.expect("create");
    assert_eq!(
        created.description.as_deref(),
        Some(PATCHABLE_DESCRIPTION),
        "the fixture starts with a description, or clearing it proves nothing"
    );

    // A patch that omits the keys leaves the stored values alone — the half of
    // `COALESCE`'s original intent that must survive.
    let untouched = store
        .update_owned(
            OWNER_ID,
            &created.id,
            ProductPatch { price: Patch::Set(Some(7.0)), ..Default::default() },
        )
        .await
        .expect("patch a price")
        .expect("the row");
    assert_eq!(
        untouched.description.as_deref(),
        Some(PATCHABLE_DESCRIPTION),
        "an omitted field is untouched"
    );
    assert_eq!(untouched.price, 7.0, "and the field that was sent is written");

    // Setting a text field to `None` clears it, and the row the call answers with
    // reports it cleared. Red on both implementations before `Patch` existed.
    let cleared = store
        .update_owned(
            OWNER_ID,
            &created.id,
            ProductPatch { description: Patch::Set(None), ..Default::default() },
        )
        .await
        .expect("clear the description")
        .expect("the row");
    assert_eq!(
        cleared.description, None,
        "an explicit null clears the column, not just the answer"
    );

    // Cleared once, cleared for a reader too — a patch that only changed its own
    // answer would pass the line above.
    assert_eq!(
        store.find_by_id(&created.id).await.expect("public read").expect("the row").description,
        None,
        "the clear reached the row a shopper reads"
    );

    // A field can also be set back, so the state space is symmetric rather than
    // one-way.
    let restored = store
        .update_owned(
            OWNER_ID,
            &created.id,
            ProductPatch {
                description: Patch::Set(Some(PATCHABLE_DESCRIPTION.to_string())),
                ..Default::default()
            },
        )
        .await
        .expect("set the description")
        .expect("the row");
    assert_eq!(restored.description.as_deref(), Some(PATCHABLE_DESCRIPTION));

    // Every field `Unset` changes nothing at all, and still answers with the
    // current product rather than an error. This is what `is_empty` is for.
    let noop = store
        .update_owned(OWNER_ID, &created.id, ProductPatch::default())
        .await
        .expect("an all-`Unset` patch is not an error")
        .expect("the row");
    assert_eq!(
        noop.description.as_deref(),
        Some(PATCHABLE_DESCRIPTION),
        "an empty patch changes nothing"
    );
    assert_eq!(noop.price, 7.0);
}

/// The value [`a_patch_distinguishes_absent_from_cleared`] sets and clears.
const PATCHABLE_DESCRIPTION: &str = "Full-grain leather.";

/// The value on a product is whatever the owner's row says *now*. Production
/// joins on every read; a write-time snapshot would answer the old name here,
/// and the rename is the only way to tell the two apart.
async fn a_store_name_is_the_sellers_current_one<S, F, Fut>(store: &S, rename_seller: F)
where
    S: MarketplaceStore + ?Sized,
    F: FnOnce(&str, &str) -> Fut,
    Fut: Future<Output = ()>,
{
    let created = store.create(OWNER_ID, new_product("Renamable")).await.expect("create");
    assert_eq!(
        created.store_name.as_deref(),
        Some(OWNER_STORE_NAME),
        "a write answers with the join, the same value the next read gives"
    );

    rename_seller(OWNER_ID, RENAMED_STORE_NAME).await;

    assert_eq!(
        store.find_by_id(&created.id).await.expect("read").expect("the row").store_name.as_deref(),
        Some(RENAMED_STORE_NAME),
        "the store name is joined at read time, not copied at write time"
    );
    assert_eq!(
        store
            .list_page_for_owner(OWNER_ID, 0, PAGE_SIZE)
            .await
            .expect("owned page")
            .iter()
            .find(|product| product.id == created.id)
            .expect("the row is on its owner's page")
            .store_name
            .as_deref(),
        Some(RENAMED_STORE_NAME),
        "and on the owner-scoped page, which joins the same way but by another query"
    );
}

/// A refused registration must leave the row it collided with untouched.
/// Production maps any unique violation to `EmailTaken`, so a repeat of either
/// unique column is refused — including the primary key, which is the one a
/// `HashMap::insert` would silently overwrite.
async fn a_refused_registration_changes_nothing<S: MarketplaceStore + ?Sized>(store: &S) {
    let before = store
        .find_user_by_email(OWNER_EMAIL)
        .await
        .expect("look the seller up")
        .expect("the suite registered one");

    // A fresh id, so this case is the address alone.
    let same_email =
        store.create_user(new_user("usr_store_contract_third", OWNER_EMAIL, "Stolen")).await;
    assert!(
        matches!(same_email, Err(StoreError::EmailTaken)),
        "a repeat address is refused, got {same_email:?}"
    );

    let same_id = store.create_user(new_user(OWNER_ID, "another@rnw.test", "Stolen")).await;
    assert!(
        matches!(same_id, Err(StoreError::EmailTaken)),
        "a repeat id is refused rather than overwriting the row, got {same_id:?}"
    );

    let after = store
        .find_user_by_email(OWNER_EMAIL)
        .await
        .expect("look the seller up again")
        .expect("still there");
    assert_eq!(before, after, "a refused registration must change nothing at all");
    assert_eq!(after.user.store_name, RENAMED_STORE_NAME, "nor the store name it carries");
    assert_eq!(
        store.find_user_by_id(OWNER_ID).await.expect("by id").expect("still there").id,
        OWNER_ID
    );
}

/// An expired row is not a session: the check is folded into the lookup, so
/// correctness does not depend on a reaper having swept.
async fn expiry_is_folded_into_the_session_lookup<S: MarketplaceStore + ?Sized>(store: &S) {
    let now = chrono::Utc::now().naive_utc();
    let expired = "contract-expired-token";
    let live = "contract-live-token";

    store
        .create_session(expired, OWNER_ID, now - chrono::Duration::hours(1))
        .await
        .expect("create");
    assert!(
        store.find_valid_session(expired).await.expect("lookup").is_none(),
        "an expired row is not a session"
    );

    store.create_session(live, OWNER_ID, now + chrono::Duration::hours(1)).await.expect("create");
    let found = store.find_valid_session(live).await.expect("lookup").expect("a live session");
    assert_eq!(found.user_id, OWNER_ID);

    assert!(store.delete_session(live).await.expect("delete"));
    assert!(
        !store.delete_session(live).await.expect("delete twice"),
        "logging out twice is not an error"
    );
}

/// The lifecycle half the lookup half made unnecessary to think about: a seller's
/// dead rows can leave the table, and their live ones can be seen.
///
/// Several sessions per seller is intended behaviour and stays — the point is
/// that nothing could enumerate them or reclaim the dead ones, so `"Session"` was
/// an append-only log of login events. A `retain` that forgets the per-user scope,
/// or a delete that takes a live row with it, passes every assertion above and
/// fails this one.
async fn expired_sessions_leave_the_table_and_live_ones_are_enumerable<
    S: MarketplaceStore + ?Sized,
>(
    store: &S,
) {
    store
        .create_user(new_user(
            LIFECYCLE_OWNER_ID,
            LIFECYCLE_OWNER_EMAIL,
            LIFECYCLE_OWNER_STORE_NAME,
        ))
        .await
        .expect("register the lifecycle seller");

    let now = chrono::Utc::now().naive_utc();
    let dead = "contract-lifecycle-dead";
    let older = "contract-lifecycle-older";
    let newer = "contract-lifecycle-newer";
    // Expired, but somebody else's: the proof that the sweep is scoped to one
    // seller rather than being a global reaper in disguise.
    let not_mine = "contract-lifecycle-not-mine";

    for (token, user_id, expires_at) in [
        (dead, LIFECYCLE_OWNER_ID, now - chrono::Duration::hours(2)),
        (older, LIFECYCLE_OWNER_ID, now + chrono::Duration::minutes(10)),
        (newer, LIFECYCLE_OWNER_ID, now + chrono::Duration::hours(10)),
        (not_mine, OTHER_OWNER_ID, now - chrono::Duration::hours(2)),
    ] {
        store.create_session(token, user_id, expires_at).await.expect("create a session");
    }

    assert_eq!(
        store.delete_expired_for_user(LIFECYCLE_OWNER_ID).await.expect("sweep"),
        1,
        "exactly one of this seller's rows is past its expiry"
    );

    let live = store.list_sessions(LIFECYCLE_OWNER_ID).await.expect("list");
    assert_eq!(live.len(), 2, "the two rows still inside their expiry: {live:?}");
    assert!(
        live.windows(2).all(|pair| pair[0].expires_at >= pair[1].expires_at),
        "newest first, so a devices list reads top-down: {live:?}"
    );
    assert!(
        live.iter().all(|session| session.user_id == LIFECYCLE_OWNER_ID),
        "one seller's sessions, never another's: {live:?}"
    );

    // Nothing left to reclaim says so rather than claiming work it did not do.
    assert_eq!(store.delete_expired_for_user(LIFECYCLE_OWNER_ID).await.expect("sweep again"), 0);

    // The proof that `not_mine` was left alone rather than swept by proxy: it is
    // still in the table, for its own owner to reclaim. A `find_valid` check could
    // not tell the two cases apart — an expired row is `None` either way.
    assert_eq!(
        store.delete_expired_for_user(OTHER_OWNER_ID).await.expect("the other seller's sweep"),
        1,
        "another seller's expired row survives a sweep that was not theirs"
    );
}

/// A product to write, identical for both implementations apart from the row
/// they end up putting it in.
fn new_product(title: &str) -> NewProduct {
    NewProduct {
        title: title.to_string(),
        description: None,
        price: 19.5,
        image_url: None,
        stock: 2,
    }
}

/// The same, with a description to clear. A row that starts out `NULL` would make
/// the clearing assertion vacuous — it would pass against an implementation that
/// ignored the patch entirely.
fn text_product(title: &str) -> NewProduct {
    NewProduct { description: Some(PATCHABLE_DESCRIPTION.to_string()), ..new_product(title) }
}

fn new_user(id: &str, email: &str, store_name: &str) -> super::users::NewUser {
    super::users::NewUser {
        id: id.to_string(),
        email: email.to_string(),
        // Never compared, only carried: `UserRecord`'s equality is what proves
        // the row survived a refused registration.
        password_hash: "$argon2id$not-a-real-hash".to_string(),
        store_name: store_name.to_string(),
    }
}
