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
//! [`assert_a_write_takes_one_connection`] is the one exception, and it is a
//! deliberate one: the pool is not part of the store *interface*, so the double
//! has nothing to disagree about. It runs against the SQL store only, under
//! `test:e2e`.
//!
//! Every assertion here is one both implementations should still hold in two
//! years. An assertion that pinned today's behaviour of either one would make
//! the bug permanent, which is the reason this suite is small.

use std::future::Future;
use std::time::Duration;

use chrono::NaiveDateTime;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};

use super::products::{
    NewProduct, Patch, Product, ProductPatch, ProductStore, SqlProductStore, StoreError, PAGE_SIZE,
};
use super::sessions::SessionStore;
use super::users::UserStore;
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
/// A seller of its own for the ordering assertion, so the page it reads back is
/// exactly the rows that assertion put there and nothing inherited from the
/// assertions above.
const ORDERING_OWNER_ID: &str = "usr_store_contract_ordering";
const ORDERING_OWNER_EMAIL: &str = "store-contract-ordering@rnw.test";
const ORDERING_OWNER_STORE_NAME: &str = "Ordering Contract Shop";
/// A fourth seller, for the batch-read assertion, so the three rows it compares
/// are exactly the three it created rather than a slice of the seeded catalogue.
const BATCH_OWNER_ID: &str = "usr_store_contract_batch";
const BATCH_OWNER_EMAIL: &str = "store-contract-batch@rnw.test";
const BATCH_OWNER_STORE_NAME: &str = "Batch Contract Shop";

/// Its own seller for the connection assertion, so a caller that runs it after
/// [`assert_store_contract`] in the same database cannot collide on either unique
/// column — the address is the one `create_user` refuses on.
const WIDE_OWNER_ID: &str = "usr_store_contract_one_permit";
const WIDE_OWNER_EMAIL: &str = "store-contract-one-permit@rnw.test";
const WIDE_STORE_NAME: &str = "One Permit Contract Shop";

/// Ids chosen so byte order and a locale collation *cannot* agree. Every pair
/// differs only in case, and case is the one thing the two rules order
/// oppositely: `A` is 0x41 and `a` is 0x61, so byte order puts every uppercase
/// id ahead of every lowercase one, while glibc and ICU collations fold case and
/// then put the lowercase form first.
///
/// `generate_product_id` mints exactly this shape — base64 over CSPRNG bytes,
/// alphabet `A-Z a-z 0-9 - _` — so this is production's id set rather than an
/// artificial one. Every fixture id is lowercase ASCII, which is the other half
/// of why this has never bitten: byte order and a locale collation happen to
/// agree on that set.
const MIXED_CASE_IDS: [&str; 6] =
    ["prd_aaa", "prd_bbb", "prd_ccc", "prd_Aaa", "prd_Bbb", "prd_Ccc"];

/// The `createdAt` all six share, older than any row a harness seeds. Sharing
/// one timestamp is what makes the tiebreaker load-bearing rather than
/// decorative — it decides the page split only when rows tie, and ties are the
/// normal case for a bulk-seeded catalogue.
const SHARED_CREATED_AT: &str = "2020-01-01 00:00:00.000";

/// Run every store-layer assertion against `store`.
///
/// `rename_seller` is the one thing the suite cannot do through the traits: no
/// store has a method for renaming a seller, so a product's store name is
/// joined from the owner's row rather than copied at write time — which is
/// precisely the invariant being tested, and precisely the one that cannot be
/// reached without an out-of-band edit. Each harness supplies that edit: SQL for
/// Postgres, the map behind it for the double.
///
/// `seed_rows` is the same kind of escape hatch, for a second reason. `create`
/// mints the id from the CSPRNG and stamps the clock, so the suite cannot make
/// two rows tie on `createdAt` — and a tie is the only situation in which the
/// `id` half of the ordering contract decides anything at all. Asserting an
/// ordering the harness cannot construct would be asserting nothing, which is
/// how the previous version of this suite left the one invariant both stores are
/// documented to share unchecked.
pub async fn assert_store_contract<S, F, Fut, G, Gfut>(store: &S, rename_seller: F, seed_rows: G)
where
    S: MarketplaceStore + ?Sized,
    F: FnOnce(&str, &str) -> Fut,
    Fut: Future<Output = ()>,
    G: FnOnce(&str, &[&str], NaiveDateTime) -> Gfut,
    Gfut: Future<Output = ()>,
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
    the_tiebreaker_is_byte_order(store, seed_rows).await;
    a_batch_read_is_the_singular_read_repeated(store).await;
    a_cross_owner_row_is_invisible_not_forbidden(store).await;
    a_patch_distinguishes_absent_from_cleared(store).await;
    a_store_name_is_the_sellers_current_one(store, rename_seller).await;
    a_refused_registration_changes_nothing(store).await;
    expiry_is_folded_into_the_session_lookup(store).await;
    expired_sessions_leave_the_table_and_live_ones_are_enumerable(store).await;
}

/// A store method holds at most one primary connection at a time — the rule
/// `DB_MAX_CONNECTIONS` is sized against, and the only one nothing checked.
///
/// `create`, `update_owned` and `create_user` each used to acquire a *second*
/// connection from the primary while still holding the first: the second `let`
/// shadowed the first, and Rust does not drop the shadowed binding. Two
/// `PoolConnection`s are two permits from a pool sized for one per request, and
/// a permit comes back only when its guard drops — so every in-flight write
/// halved the service's write concurrency, and `N` concurrent writes against a
/// pool of `N` all died on `PoolTimedOut` rather than all answering. Nothing
/// caught it because the two acquisitions each look right in isolation, and the
/// defect lives only in their interaction.
///
/// A pool of one is the tightest formulation of the rule and needs no
/// arithmetic: a method that acquires twice blocks on its own second acquire and
/// fails here. That is the point of putting it in the contract suite rather than
/// in a comment — the next method added to a store is checked against the rule
/// instead of against a reviewer noticing a second `acquire_primary`.
///
/// `SqlProductStore`-only, and unlike [`assert_store_contract`] not run against
/// the double: the double has no pool, so asserting it there would assert nothing
/// about the double. `options` are the harness's own connect options, so this
/// runs against the database the rest of the suite uses without the suite needing
/// to know the url.
pub async fn assert_a_write_takes_one_connection(options: PgConnectOptions) {
    // Long enough that a correct method never notices it, short enough that a
    // double-acquiring one fails the test instead of hanging it.
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(2))
        .connect_with(options)
        .await
        .expect("connect the single-connection pool");
    let store = SqlProductStore::new(pool);

    store
        .create_user(new_user(WIDE_OWNER_ID, WIDE_OWNER_EMAIL, WIDE_STORE_NAME))
        .await
        .expect("register a seller against a pool of one");

    let created =
        store.create(WIDE_OWNER_ID, new_product("One Permit")).await.expect("create against one");

    store
        .update_owned(
            WIDE_OWNER_ID,
            &created.id,
            ProductPatch { price: Patch::Set(Some(7.0)), ..Default::default() },
        )
        .await
        .expect("update against a pool of one")
        .expect("the row it just created");

    // The other branch of `update_owned`: the early return answers `None` before
    // the read-back, so it is the one write here that holds no connection at all
    // by the time it answers. Exercised so the assertion covers both exits.
    assert!(
        store
            .update_owned(WIDE_OWNER_ID, "prd_never_existed", ProductPatch::default())
            .await
            .expect("a missing row is still an answered call")
            .is_none(),
        "a patch to a row that does not exist is absent, not an error"
    );

    assert!(
        store.delete_owned(WIDE_OWNER_ID, &created.id).await.expect("delete against one"),
        "delete against a pool of one"
    );

    let now = chrono::Utc::now().naive_utc();
    store
        .create_session("one-permit-live", WIDE_OWNER_ID, now + chrono::Duration::hours(1))
        .await
        .expect("create a session against a pool of one");
    assert!(
        store.delete_session("one-permit-live").await.expect("delete a session against one"),
        "session writes take one permit too"
    );
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
    let first_page = store.list_page(0, PAGE_SIZE).await.expect("first page");
    assert!(!first_page.is_empty(), "the harness must seed at least one product");

    let whole = store.list_page(0, i64::MAX).await.expect("the whole catalogue");
    assert_eq!(
        first_page.first().map(|product| product.id.as_str()),
        whole.first().map(|product| product.id.as_str()),
        "offset 0 is the first row, not a page of its own"
    );

    let total = store.count().await.expect("count the catalogue");
    assert_eq!(total, whole.len() as i64, "the total is the whole catalogue");
    assert!(
        store.list_page(total, PAGE_SIZE).await.expect("offset past the end").is_empty(),
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

    assert!(store.list_page(0, 0).await.expect("limit 0").is_empty(), "limit 0 is an empty page");
    assert_eq!(
        store.count_for_owner(OWNER_ID).await.expect("count a seller with nothing"),
        0,
        "a registered seller with no products counts zero"
    );

    assert!(
        store.list_page(-1, PAGE_SIZE).await.is_err(),
        "a negative offset is refused, not clamped to page one"
    );
    assert!(
        store.list_page(0, -1).await.is_err(),
        "a negative limit is refused, not read as unlimited"
    );
}

/// The list order is a *total* order, and this is the assertion that says so.
///
/// `createdAt` is `TIMESTAMP(3)` and seeds insert in bulk, so most rows in any
/// real catalogue share a timestamp and the `id` tiebreaker decides which of
/// them lands on page 1. Every other assertion in this file compares a page
/// against itself, so each implementation was only ever checked against its own
/// ordering: both a byte-order implementation and a locale-collation one pass
/// every test in the suite while disagreeing about page 1. That is the hole.
///
/// `MIXED_CASE_IDS` is what gives the assertion teeth. Byte order and
/// `en_US`/ICU put the six ids in opposite sequences, so an unpinned
/// `ORDER BY p."id" ASC` fails here against Postgres while the double — which
/// uses `String: Ord` — cannot. Asserting it in the suite that runs against both
/// is the only place the disagreement can be caught.
async fn the_tiebreaker_is_byte_order<S, G, Gfut>(store: &S, seed_rows: G)
where
    S: MarketplaceStore + ?Sized,
    G: FnOnce(&str, &[&str], NaiveDateTime) -> Gfut,
    Gfut: Future<Output = ()>,
{
    store
        .create_user(new_user(ORDERING_OWNER_ID, ORDERING_OWNER_EMAIL, ORDERING_OWNER_STORE_NAME))
        .await
        .expect("register the ordering seller");

    let shared = NaiveDateTime::parse_from_str(SHARED_CREATED_AT, "%Y-%m-%d %H:%M:%S%.3f")
        .expect("the shared timestamp");
    seed_rows(ORDERING_OWNER_ID, &MIXED_CASE_IDS, shared).await;

    let page = store
        .list_page_for_owner(ORDERING_OWNER_ID, 0, PAGE_SIZE)
        .await
        .expect("the ordering seller's page");

    // Restated rather than re-derived: the expectation is byte order, spelled
    // out, so a reader can see which of the two candidate rules this pins
    // without reading `sort_by_contract`. `C` is what makes Postgres agree —
    // see `migrations/20261004210000_pin_product_id_collation`.
    let expected = ["prd_Aaa", "prd_Bbb", "prd_Ccc", "prd_aaa", "prd_bbb", "prd_ccc"];
    let ids: Vec<&str> = page.iter().map(|product| product.id.as_str()).collect();
    assert_eq!(ids, expected, "the id tiebreaker is byte order, for both stores");

    // And the half that makes it a tiebreaker rather than a coincidence: the
    // rows really do share one timestamp, so the order above was decided by
    // `id` alone. Without this the assertion above would also pass if
    // `createdAt` happened to separate them.
    assert!(
        page.iter().all(|product| product.created_at == shared),
        "every seeded row shares one createdAt, so id alone decided the order"
    );
}

/// `find_by_ids` is the singular read repeated, with the ids it cannot answer
/// simply absent.
///
/// This is the assertion that makes the batch safe to swap in, and it is here
/// rather than in a handler test because the two implementations could otherwise
/// disagree about it: the double filters a `Vec` and Postgres runs
/// `WHERE p."id" = ANY($1)`, and only the second one can be wrong in the way that
/// matters — an `ANY` binding that matched nothing, matched everything, or
/// returned a placeholder for a missing id. The handler cannot catch any of
/// those, because it reconstructs `missing` from the ids it asked for.
///
/// Order is deliberately *not* asserted. `= ANY` does not preserve argument
/// order and the double has no reason to; rebuilding first-seen order is the
/// handler's job, and it is asserted there.
async fn a_batch_read_is_the_singular_read_repeated<S: MarketplaceStore + ?Sized>(store: &S) {
    // Its own seller, so the three rows are exactly the ones this assertion
    // created and nothing inherited from the catalogue the harness seeds.
    store
        .create_user(new_user(BATCH_OWNER_ID, BATCH_OWNER_EMAIL, BATCH_OWNER_STORE_NAME))
        .await
        .expect("register the batch seller");

    let mut created: Vec<String> = Vec::new();
    for index in 0..3 {
        let product = store
            .create(BATCH_OWNER_ID, new_product(&format!("Batch Mug {index}")))
            .await
            .expect("create a batched row");
        created.push(product.id);
    }

    let mut requested = created.clone();
    requested.push("prd_never_existed".to_string());
    let batch = store.find_by_ids(&requested).await.expect("read the batch");

    let mut expected: Vec<Product> = Vec::new();
    for id in &created {
        expected.push(store.find_by_id(id).await.expect("singular read").expect("the row exists"));
    }

    assert_eq!(
        batch.len(),
        created.len(),
        "an id that does not exist is absent from the batch, not an error or a placeholder"
    );
    let mut batched_ids: Vec<&str> = batch.iter().map(|product| product.id.as_str()).collect();
    let mut singular_ids: Vec<&str> = expected.iter().map(|product| product.id.as_str()).collect();
    batched_ids.sort_unstable();
    singular_ids.sort_unstable();
    assert_eq!(batched_ids, singular_ids, "the batch is exactly the singular reads");

    // Compared field by field, because "the same ids" is weaker than "the same
    // rows": a batch query that skipped the `LEFT JOIN "User"`, say, would return
    // the right ids with a null store name, and the id comparison would pass.
    for product in &batch {
        let singular = expected.iter().find(|other| other.id == product.id).expect("a known id");
        assert_eq!(
            product.store_name, singular.store_name,
            "a batched row carries the same joined seller row as a singular one"
        );
        assert_eq!(product.price, singular.price, "and the same values");
    }

    assert!(
        store.find_by_ids(&[]).await.expect("an empty batch is not an error").is_empty(),
        "an empty id list is an empty result"
    );
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
