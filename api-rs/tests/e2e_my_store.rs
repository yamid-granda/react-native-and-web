//! The seller's write path against a real server, a real Postgres and a real
//! Valkey.
//!
//! Three things here are worth stating up front, because each is a design
//! decision rather than an implementation detail:
//!
//! 1. **Owner-scoped reads go to the primary.** A seller sees their own write on
//!    the very next request. The public marketplace may lag by replica lag, and
//!    the tests that care about that say so explicitly.
//! 2. **Ownership failures are 404s.** A 403 would confirm that an id exists on a
//!    public catalogue.
//! 3. **A write retires the cached public read path.** These tests warm the cache
//!    first and then assert the *very next* request is not a stale hit — the
//!    cache-invalidation contract is the reason the list-generation counter
//!    exists.

mod common;

use std::sync::Arc;
use std::time::Duration;

use reqwest::header::{HeaderValue, AUTHORIZATION};
use reqwest::{Client, StatusCode};
use serde_json::{json, Value};
use sqlx::postgres::PgPoolOptions;

use api_rs::store::SqlProductStore;

const PASSWORD: &str = "correct horse battery";

/// Lowercased: the store normalises addresses on insert, so the value a test
/// reads back is not the value it sent.
fn unique_email(prefix: &str) -> String {
    format!("{prefix}-{}@rnw.test", common::unique_suffix()).to_lowercase()
}

/// Registers and returns `(token, storeId)`.
async fn sign_up(stack: &common::TestStack, prefix: &str) -> (String, String) {
    let client = Client::new();
    let response = client
        .post(format!("{}/auth/register", stack.base_url))
        .json(&json!({
            "email": unique_email(prefix),
            "password": PASSWORD,
            "storeName": "Riverbend Vintage",
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let body: Value = response.json().await.unwrap();
    (
        body["token"].as_str().expect("token").to_string(),
        body["user"]["id"].as_str().expect("id").to_string(),
    )
}

fn authed(method: reqwest::Method, url: &str, token: &str) -> reqwest::RequestBuilder {
    Client::new()
        .request(method, url)
        .header(AUTHORIZATION, HeaderValue::from_str(&format!("Bearer {token}")).unwrap())
}

/// Finds a product by id anywhere in the public paged list.
///
/// A page number would be wrong here: the list is `createdAt ASC`, so a product
/// created *now* sorts last, past the 26 fixtures. Walking the pages keeps the
/// assertion about what a shopper can see rather than about where it happens to
/// fall today.
async fn find_in_marketplace(client: &Client, base: &str, id: &str) -> Option<Value> {
    for page in 1..=8 {
        let response = client.get(format!("{base}/products?page={page}")).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body: Value = response.json().await.unwrap();
        let found =
            body["items"].as_array().expect("items").iter().find(|item| item["id"] == id).cloned();
        if found.is_some() || !body["hasNextPage"].as_bool().unwrap_or(false) {
            return found;
        }
    }
    None
}

async fn create_product(base: &str, token: &str, title: &str) -> Value {
    let response = authed(reqwest::Method::POST, &format!("{base}/my-store/products"), token)
        .json(&json!({ "title": title, "price": 42.5, "stock": 3 }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED, "creating {title}");
    response.json().await.unwrap()
}

#[tokio::test]
async fn a_seller_sees_their_own_write_immediately() {
    let stack = common::TestStack::start(true, |_| {}).await;
    let (token, store_id) = sign_up(&stack, "read-your-writes").await;

    let created = create_product(&stack.base_url, &token, "Leather Weekender").await;
    let id = created["id"].as_str().expect("id");

    // Immediately. This is the assertion that proves the owner-scoped read went
    // to the primary: with a read replica configured this is where a laggy
    // implementation would show the product missing.
    let page: Value =
        authed(reqwest::Method::GET, &format!("{}/my-store/products", stack.base_url), &token)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
    assert_eq!(page["total"], 1);
    assert_eq!(page["items"][0]["id"], id);
    assert_eq!(page["items"][0]["storeName"], "Riverbend Vintage");

    // And on the seller's public store page — which is *not* an owner-scoped
    // read. That page is eventually consistent by choice: it may be answered by
    // a replica, so a just-created product can be briefly absent from it. This
    // stack has no `DATABASE_READ_URL`, so the storefront reads the primary and
    // the product is there straight away; with a replica configured, the two
    // assertions below would be about replica lag instead. The replica-only
    // fixture carries no owner, so the storefront's routing is not E2E-pinned
    // either way — `handlers::stores` asserts the read path.
    let store_page: Value = Client::new()
        .get(format!("{}/stores/{store_id}/products", stack.base_url))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(store_page["total"], 1);
    assert_eq!(store_page["items"][0]["id"], id);
}

#[tokio::test]
async fn a_created_product_reaches_the_public_marketplace_and_back() {
    let stack = common::TestStack::start(true, |_| {}).await;
    let (token, store_id) = sign_up(&stack, "public").await;
    let created = create_product(&stack.base_url, &token, "Brass Desk Lamp").await;
    let id = created["id"].as_str().expect("id").to_string();

    // `GET /products` reads from the replica, which this stack has not got — so
    // it reads the primary and the product is there straight away. With
    // DATABASE_READ_URL set, this assertion would be about replica lag instead.
    let client = Client::new();
    let page: Value = client
        .get(format!("{}/products?page=1", stack.base_url))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(page["total"], 27, "26 fixtures plus this one");
    let listed = find_in_marketplace(&client, &stack.base_url, &id)
        .await
        .expect("a seller's product is in the public marketplace");
    assert_eq!(listed["storeName"], "Riverbend Vintage");

    // The detail read names the seller.
    let detail: Value = client
        .get(format!("{}/products/{id}", stack.base_url))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(detail["storeId"], store_id.as_str());
    assert_eq!(detail["storeName"], "Riverbend Vintage");
}

#[tokio::test]
async fn patching_then_deleting_is_visible_everywhere_it_matters() {
    let stack = common::TestStack::start(true, |_| {}).await;
    let (token, _store_id) = sign_up(&stack, "edit").await;
    let created = create_product(&stack.base_url, &token, "Trail Camera").await;
    let id = created["id"].as_str().expect("id").to_string();

    let response = authed(
        reqwest::Method::PATCH,
        &format!("{}/my-store/products/{id}", stack.base_url),
        &token,
    )
    .json(&json!({ "title": "Trail Camera v2", "price": 199.99 }))
    .send()
    .await
    .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // The public detail read reflects it, which is only true if
    // `invalidate_detail` ran.
    let detail: Value = Client::new()
        .get(format!("{}/products/{id}", stack.base_url))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(detail["title"], "Trail Camera v2");
    assert_eq!(detail["price"], 199.99);

    assert_eq!(
        authed(
            reqwest::Method::DELETE,
            &format!("{}/my-store/products/{id}", stack.base_url),
            &token
        )
        .send()
        .await
        .unwrap()
        .status(),
        StatusCode::NO_CONTENT
    );

    assert_eq!(
        Client::new()
            .get(format!("{}/products/{id}", stack.base_url))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    let page: Value =
        authed(reqwest::Method::GET, &format!("{}/my-store/products", stack.base_url), &token)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
    assert_eq!(page["total"], 0);
}

/// Deleting a description or an image has to reach the row, not just the `200`.
///
/// Before this, every spelling of "cleared" was swallowed — `""`, `"   "`, `null`
/// and an absent key all left the stored text in place, so a seller who deleted a
/// description saw it come back on the storefront. The four cases below are the
/// four ways a client can say it, and each has to end in `NULL` in the public read.
#[tokio::test]
async fn clearing_a_text_field_is_visible_through_the_public_read() {
    let stack = common::TestStack::start(true, |_| {}).await;
    let (token, _store_id) = sign_up(&stack, "clear").await;

    let created =
        authed(reqwest::Method::POST, &format!("{}/my-store/products", stack.base_url), &token)
            .json(&json!({
                "title": "Waxed Canvas Bag",
                "description": "Full-grain leather.",
                "price": 189,
                "imageUrl": "https://example.test/bag.png",
                "stock": 4,
            }))
            .send()
            .await
            .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let created: Value = created.json().await.unwrap();
    let id = created["id"].as_str().expect("id").to_string();
    let uri = format!("{}/my-store/products/{id}", stack.base_url);

    // `""` and `"   "` are what the shared form submits for a field the seller
    // emptied; `null` is the explicit spelling. All three clear.
    for payload in [
        json!({ "description": "", "imageUrl": "" }),
        json!({ "description": "   ", "imageUrl": "   " }),
        json!({ "description": null, "imageUrl": null }),
    ] {
        let response =
            authed(reqwest::Method::PATCH, &uri, &token).json(&payload).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{payload}");

        let detail: Value = Client::new()
            .get(format!("{}/products/{id}", stack.base_url))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(detail["description"], Value::Null, "{payload} did not clear the description");
        assert_eq!(detail["imageUrl"], Value::Null, "{payload} did not clear the image");
    }

    // The other half, and the one that keeps `PATCH` a `PATCH`: omitting a key
    // leaves the stored value alone. It is also the state that cannot be told from
    // `null` by any implementation that binds one optional value per column.
    let response = authed(reqwest::Method::PATCH, &uri, &token)
        .json(&json!({ "description": "Waxed, not leather.", "price": 199 }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = authed(reqwest::Method::PATCH, &uri, &token)
        .json(&json!({ "price": 12 }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let detail: Value = Client::new()
        .get(format!("{}/products/{id}", stack.base_url))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        detail["description"], "Waxed, not leather.",
        "an omitted key left the description alone"
    );
    assert_eq!(detail["imageUrl"], Value::Null, "and did not resurrect the cleared image");
    assert_eq!(detail["price"], 12, "while the field that was sent moved");
}

/// Another seller gets a 404 for someone else's product: not a 403, which would
/// confirm the id exists.
#[tokio::test]
async fn another_seller_cannot_touch_someone_elses_product() {
    let stack = common::TestStack::start(true, |_| {}).await;
    let (owner_token, _owner) = sign_up(&stack, "owner").await;
    let (stranger_token, _stranger) = sign_up(&stack, "stranger").await;

    let created = create_product(&stack.base_url, &owner_token, "Not Yours").await;
    let id = created["id"].as_str().expect("id").to_string();
    let uri = format!("{}/my-store/products/{id}", stack.base_url);

    assert_eq!(
        authed(reqwest::Method::PATCH, &uri, &stranger_token)
            .json(&json!({ "price": 0.01 }))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        authed(reqwest::Method::DELETE, &uri, &stranger_token).send().await.unwrap().status(),
        StatusCode::NOT_FOUND
    );

    // Still the owner's, still the original price.
    let page: Value = authed(
        reqwest::Method::GET,
        &format!("{}/my-store/products", stack.base_url),
        &owner_token,
    )
    .send()
    .await
    .unwrap()
    .json()
    .await
    .unwrap();
    assert_eq!(page["items"][0]["price"], 42.5);
}

/// The point of the list-generation counter: a page warmed *before* a write must
/// not be served after it. Warming first and asserting on the very next request
/// is what makes this a real test rather than a test of a cold cache.
#[tokio::test]
async fn a_write_retires_every_cached_list_page() {
    let stack = common::TestStack::start(true, |_| {}).await;
    let client = Client::new();
    let (token, _store_id) = sign_up(&stack, "invalidate").await;

    for page in [1, 2] {
        let response =
            client.get(format!("{}/products?page={page}", stack.base_url)).send().await.unwrap();
        assert_eq!(response.headers()["x-cache"], "miss");
        // Second time round it is definitely cached in both tiers.
        assert_eq!(
            client
                .get(format!("{}/products?page={page}", stack.base_url))
                .send()
                .await
                .unwrap()
                .headers()["x-cache"],
            "hit-l1"
        );
    }

    let created = create_product(&stack.base_url, &token, "Invalidation Probe").await;
    let id = created["id"].as_str().expect("id").to_string();

    // Both pages, not just page 1: retiring "the" list key is exactly the thing a
    // per-page invalidation cannot do.
    for page in [1, 2] {
        let response =
            client.get(format!("{}/products?page={page}", stack.base_url)).send().await.unwrap();
        assert_eq!(response.headers()["x-cache"], "miss", "page {page} was stale");
    }

    // `total` is cached separately and moves when a product is added.
    let response = client.get(format!("{}/products?page=1", stack.base_url)).send().await.unwrap();
    let page: Value = response.json().await.unwrap();
    assert_eq!(page["total"], 27);
    assert!(
        find_in_marketplace(&client, &stack.base_url, &id).await.is_some(),
        "the new product must be in the marketplace the very next time it is asked for"
    );

    // A delete has to retire them too, and remove the row from `total`.
    authed(reqwest::Method::DELETE, &format!("{}/my-store/products/{id}", stack.base_url), &token)
        .send()
        .await
        .unwrap();
    let response = client.get(format!("{}/products?page=1", stack.base_url)).send().await.unwrap();
    assert_eq!(response.headers()["x-cache"], "miss");
    let page: Value = response.json().await.unwrap();
    assert_eq!(page["total"], 26);
    assert!(find_in_marketplace(&client, &stack.base_url, &id).await.is_none());
}

/// The cross-instance half of the `INCR` contract.
///
/// The writing instance is correct immediately, because `bump` writes through to
/// its own atomic. Another instance is correct once its background refresher
/// re-reads the shared counter — bounded by the refresher interval, which is the
/// L2 TTL. `L2_TTL_SECS` is set to 1 here so the bound is observable inside a
/// test instead of after a minute.
#[tokio::test]
async fn a_write_on_one_instance_reaches_the_other_instances_pages() {
    let stack = common::TestStack::start(true, |config| {
        config.l2_ttl = std::time::Duration::from_secs(1);
    })
    .await;
    let (token, _store_id) = sign_up(&stack, "cross-instance").await;

    // A second server over the same database and the same Valkey, standing in for
    // another instance of the fleet.
    let other_base = {
        use std::sync::Arc;
        let store = Arc::new(api_rs::store::SqlProductStore::new(stack.pool.clone()));
        stack.serve_with_store(store).await
    };
    let client = Client::new();

    assert_eq!(
        client.get(format!("{other_base}/products")).send().await.unwrap().headers()["x-cache"],
        "miss"
    );
    assert_eq!(
        client.get(format!("{other_base}/products")).send().await.unwrap().headers()["x-cache"],
        "hit-l1"
    );

    create_product(&stack.base_url, &token, "Cross Instance").await;

    // Bounded poll rather than an immediate assert: what is being verified is
    // that the other instance *eventually* leaves the retired namespace, not that
    // it does so synchronously.
    let mut saw_the_write = false;
    for _ in 0..40 {
        let response = client.get(format!("{other_base}/products")).send().await.unwrap();
        let page: Value = response.json().await.unwrap();
        if page["total"] == 27 {
            saw_the_write = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    assert!(saw_the_write, "the other instance never retired its cached list pages");
}

/// Every seller route, without a token, is a 401 — and none of them leaks an
/// `X-Cache` marker or the marketplace's cache headers.
#[tokio::test]
async fn every_seller_route_requires_a_token_and_is_never_cacheable() {
    let stack = common::TestStack::start(true, |_| {}).await;
    let client = Client::new();

    let requests = [
        client.get(format!("{}/my-store/products", stack.base_url)),
        client.post(format!("{}/my-store/products", stack.base_url)),
        client.patch(format!("{}/my-store/products/prod-1", stack.base_url)),
        client.delete(format!("{}/my-store/products/prod-1", stack.base_url)),
        client.get(format!("{}/auth/me", stack.base_url)),
    ];
    for request in requests {
        let response = request.send().await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(response.headers()["cache-control"], "no-store");
        assert!(!response.headers().contains_key("x-cache"));
    }
}

/// A seller cannot reach a product that does not exist either, and the two are
/// indistinguishable apart from the id the caller already knows — which is the
/// point: nothing in the response says "this exists but is not yours".
#[tokio::test]
async fn a_missing_product_and_a_forbidden_one_are_the_same_404() {
    let stack = common::TestStack::start(true, |_| {}).await;
    let (owner_token, _owner) = sign_up(&stack, "same-404").await;
    let (stranger_token, _stranger) = sign_up(&stack, "same-404-other").await;
    let created = create_product(&stack.base_url, &owner_token, "Somebody's").await;
    let theirs = created["id"].as_str().expect("id").to_string();

    let forbidden: Value = authed(
        reqwest::Method::DELETE,
        &format!("{}/my-store/products/{theirs}", stack.base_url),
        &stranger_token,
    )
    .send()
    .await
    .unwrap()
    .json()
    .await
    .unwrap();
    let missing: Value = authed(
        reqwest::Method::DELETE,
        &format!("{}/my-store/products/prod-does-not-exist", stack.base_url),
        &stranger_token,
    )
    .send()
    .await
    .unwrap()
    .json()
    .await
    .unwrap();

    assert_eq!(forbidden["error"], missing["error"]);
    assert_eq!(forbidden["statusCode"], missing["statusCode"]);
    assert_eq!(forbidden["statusCode"], 404);
    assert!(
        !forbidden["message"].as_str().unwrap().contains("forbidden"),
        "the body must not hint that the resource exists: {forbidden}"
    );
}

/// Deleting the seller leaves the products listed, as anonymous entries. The
/// whole reason `ownerId` is `ON DELETE SET NULL` rather than `ON DELETE CASCADE`.
#[tokio::test]
async fn deleting_a_seller_leaves_their_products_listed() {
    let stack = common::TestStack::start(true, |_| {}).await;
    let (token, store_id) = sign_up(&stack, "deleted-seller").await;
    let created = create_product(&stack.base_url, &token, "Survivor").await;
    let id = created["id"].as_str().expect("id").to_string();

    // Deleting a seller is not a route (no account-deletion endpoint is in
    // scope), so this exercises the schema's ON DELETE rule directly.
    sqlx::query(r#"DELETE FROM "User" WHERE "id" = $1"#)
        .bind(&store_id)
        .execute(&stack.pool)
        .await
        .unwrap();

    let detail: Value = Client::new()
        .get(format!("{}/products/{id}", stack.base_url))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(detail["id"], id.as_str());
    assert!(detail["storeId"].is_null(), "the product falls back to anonymous");
    assert!(detail["storeName"].is_null());

    assert_eq!(
        Client::new()
            .get(format!("{}/stores/{store_id}", stack.base_url))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );

    // And the session went with it, by cascade.
    assert_eq!(
        Client::new()
            .get(format!("{}/auth/me", stack.base_url))
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
}

/// The `missing` half of `GET /products/by-ids`, against a real deletion.
///
/// This is the property the route exists for: a product a shopper remembered has
/// to be *reportable* as gone once its seller deletes it, or a persisted cart or
/// wishlist has no way to drop the line. It also pins the cache half — the first
/// lookup fills the detail entry the batch reads through, so the second lookup
/// answering `missing` at all is proof that the delete retired that entry rather
/// than the batch answering from its own copy.
#[tokio::test]
async fn a_deleted_product_comes_back_as_missing_from_a_batch_lookup() {
    let stack = common::TestStack::start(true, |_| {}).await;
    let (token, _store_id) = sign_up(&stack, "by-ids-missing").await;
    let created = create_product(&stack.base_url, &token, "Deleted Lantern").await;
    let id = created["id"].as_str().expect("id").to_string();

    let lookup = || async {
        Client::new()
            .get(format!("{}/products/by-ids?ids={id},prod-1", stack.base_url))
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()
    };

    let before = lookup().await;
    assert_eq!(before["missing"].as_array().map(Vec::len), Some(0));
    // Requested order, so a client can zip `items` back onto the list it holds.
    assert_eq!(before["items"].as_array().map(Vec::len), Some(2));
    assert_eq!(before["items"][0]["id"], id);
    assert_eq!(before["items"][1]["id"], "prod-1");

    assert_eq!(
        authed(
            reqwest::Method::DELETE,
            &format!("{}/my-store/products/{id}", stack.base_url),
            &token
        )
        .send()
        .await
        .unwrap()
        .status(),
        StatusCode::NO_CONTENT
    );

    // A 404 could only ever answer one id at a time, which is the whole reason
    // this is a 200 carrying both halves.
    let after = lookup().await;
    assert_eq!(after["items"].as_array().map(Vec::len), Some(1));
    assert_eq!(after["items"][0]["id"], "prod-1");
    assert_eq!(after["missing"], json!([id]));
}

/// Four concurrent writes against a pool of two all answer `201`.
///
/// This is the test whose absence let the write path reach `main`.
/// `concurrent_registrations_of_one_address_produce_exactly_one_seller`
/// (`e2e_auth.rs`) spawns four registrations against a pool of *five* — one task
/// short of the pool, which is exactly why the defect survived: eight parked
/// permits against five is already over budget, but with 4 < 5 each task's
/// second acquisition eventually resolved, so the test passed.
///
/// Below the pool size it does not resolve. Every write used to acquire a
/// *second* connection from the primary to read its own row back while still
/// holding the first — two `let`s, the second shadowing the first, and Rust not
/// dropping the shadowed binding — so four writes wanted eight permits out of
/// two. The two that took a permit could not finish to release it, so the others
/// died on `PoolTimedOut` after the acquire timeout and the handler turned that
/// into a `500` each. Red as `[201, 201, 500, 500]` before this change, and it
/// is identical to genuine pool saturation — reached by the service's own code
/// at half the configured capacity, and invisible to `cargo clippy` because
/// nothing about either query is wrong.
///
/// One permit per write is the entire difference. Nothing here makes the pool
/// larger or raises `DB_MAX_CONNECTIONS`; it stops the service spending half of
/// it, which is what turns the pool into the true per-request budget its
/// documented capacity assumes.
#[tokio::test]
async fn concurrent_writes_do_not_exhaust_the_pool() {
    let stack = common::TestStack::start(true, |_| {}).await;
    let (token, _store_id) = sign_up(&stack, "pool").await;

    // A pool of two for four writes, so the requests overlap even when the
    // scheduler hands them out staggered: two concurrent buggy writes already
    // want four permits out of two, which is enough to deadlock on its own. The
    // acquire timeout is production's default from `config.rs` rather than
    // something tighter — a regression here should fail, not flake.
    let tight = PgPoolOptions::new()
        .max_connections(2)
        .acquire_timeout(Duration::from_secs(2))
        // The harness's own database, reached through its connect options rather
        // than a second copy of the url — `serve_with_store` then points a whole
        // server at it, so this exercises the real middleware, handler and store.
        .connect_with((*stack.pool.connect_options()).clone())
        .await
        .expect("connect the tight pool");
    let base = stack.serve_with_store(Arc::new(SqlProductStore::new(tight))).await;

    let mut tasks = Vec::new();
    for index in 0..4 {
        let base = base.clone();
        let token = token.clone();
        tasks.push(tokio::spawn(async move {
            authed(reqwest::Method::POST, &format!("{base}/my-store/products"), &token)
                .json(&json!({ "title": format!("Concurrent {index}"), "price": 42.5, "stock": 3 }))
                .send()
                .await
                .expect("the write is answered")
                .status()
                .as_u16()
        }));
    }

    let mut statuses: Vec<u16> = Vec::new();
    for task in tasks {
        statuses.push(task.await.expect("the write task did not panic"));
    }
    statuses.sort_unstable();
    assert_eq!(statuses, vec![201, 201, 201, 201], "{statuses:?}");
}
