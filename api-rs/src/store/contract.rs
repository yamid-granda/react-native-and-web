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

use super::products::{NewProduct, ProductPatch, StoreError, PAGE_SIZE};
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
    a_store_name_is_the_sellers_current_one(store, rename_seller).await;
    a_refused_registration_changes_nothing(store).await;
    expiry_is_folded_into_the_session_lookup(store).await;
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
