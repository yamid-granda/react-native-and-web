mod common;

use std::sync::Arc;

use reqwest::StatusCode;
use serde_json::Value;

use api_rs::config::Config;
use api_rs::store::SqlProductStore;

/// The same store-layer assertions the in-memory double runs under
/// `cargo test --lib`, run here against Postgres. Both implementations are held
/// to one contract, so "the unit test was green because the fake agreed with
/// itself" stops being possible.
#[tokio::test]
async fn the_store_contract_holds_for_postgres() {
    let stack = common::TestStack::start(false, |_| {}).await;
    let store = SqlProductStore::new(stack.pool.clone());
    api_rs::store::contract::assert_store_contract(&store, |owner_id, new_name| {
        // Owned, not borrowed: the contract takes one future type, so the
        // closure's arguments cannot be captured by reference.
        let owner_id = owner_id.to_string();
        let new_name = new_name.to_string();
        let pool = stack.pool.clone();
        async move {
            // No store method renames a seller, which is why the contract takes
            // the rename as an argument: production has no such call either.
            sqlx::query(r#"UPDATE "User" SET "storeName" = $1 WHERE "id" = $2"#)
                .bind(new_name)
                .bind(owner_id)
                .execute(&pool)
                .await
                .expect("rename the contract's seller");
        }
    })
    .await;
}

#[tokio::test]
async fn product_read_contract_and_pagination_boundaries() {
    let stack = common::TestStack::start(true, |_| {}).await;
    let client = reqwest::Client::new();

    let response = client.get(format!("{}/products", stack.base_url)).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "application/json; charset=utf-8");
    assert_eq!(
        response.headers()["cache-control"],
        "public, max-age=0, s-maxage=30, stale-while-revalidate=60"
    );
    assert_eq!(response.headers()["x-cache"], "miss");
    let page_one: Value = response.json().await.unwrap();
    assert_eq!(page_one["items"].as_array().unwrap().len(), 20);
    assert_eq!(page_one["page"], 1);
    assert_eq!(page_one["limit"], 20);
    // 26 fixtures: the 25 seeded rows plus prod-owned-1, the one with a seller.
    assert_eq!(page_one["total"], 26);
    assert_eq!(page_one["hasNextPage"], true);
    assert_eq!(page_one["items"][0]["id"], "prod-1");
    assert_eq!(page_one["items"][0]["price"], 129.99);

    let response = client.get(format!("{}/products?page=2", stack.base_url)).send().await.unwrap();
    let page_two: Value = response.json().await.unwrap();
    assert_eq!(page_two["items"].as_array().unwrap().len(), 6);
    assert_eq!(page_two["page"], 2);
    assert_eq!(page_two["hasNextPage"], false);

    let ids_one: Vec<_> = page_one["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap())
        .collect();
    let ids_two: Vec<_> = page_two["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap())
        .collect();
    assert!(ids_one.iter().all(|id| !ids_two.contains(id)));
}

#[tokio::test]
async fn detail_404_health_and_cache_are_contract_compatible() {
    let stack = common::TestStack::start(true, |_| {}).await;
    let client = reqwest::Client::new();

    let response = client.get(format!("{}/products/prod-1", stack.base_url)).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["x-cache"], "miss");
    let detail: Value = response.json().await.unwrap();
    assert_eq!(detail["id"], "prod-1");
    assert_eq!(detail["createdAt"], "2026-01-01T00:00:00.000Z");
    // A seeded product has no seller, and the wire says so explicitly rather than
    // omitting the keys.
    assert!(detail["storeId"].is_null());
    assert!(detail["storeName"].is_null());

    sqlx::query(r#"UPDATE "Product" SET "title" = 'mutated' WHERE "id" = 'prod-1'"#)
        .execute(&stack.pool)
        .await
        .unwrap();
    let response = client.get(format!("{}/products/prod-1", stack.base_url)).send().await.unwrap();
    assert_eq!(response.headers()["x-cache"], "hit-l1");
    assert_eq!(response.json::<Value>().await.unwrap()["title"], "Wireless Headphones");

    let response =
        client.get(format!("{}/products/does-not-exist", stack.base_url)).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response.text().await.unwrap(),
        r#"{"message":"Product does-not-exist not found","error":"Not Found","statusCode":404}"#
    );

    let response = client.get(format!("{}/health", stack.base_url)).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let health: Value = response.json().await.unwrap();
    assert_eq!(health["status"], "ok");
    assert_eq!(health["info"]["database"]["status"], "up");
    assert_eq!(health["details"]["database"]["status"], "up");
}

#[tokio::test]
async fn valkey_backed_rate_limit_returns_429() {
    let stack = common::TestStack::start(true, |config: &mut Config| {
        config.rate_limit_per_ip_rps = 2;
    })
    .await;
    let client = reqwest::Client::new();
    let url = format!("{}/products", stack.base_url);

    assert_eq!(client.get(&url).send().await.unwrap().status(), StatusCode::OK);
    assert_eq!(client.get(&url).send().await.unwrap().status(), StatusCode::OK);
    let response = client.get(&url).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        response.text().await.unwrap(),
        r#"{"message":"Too Many Requests","error":"Too Many Requests","statusCode":429}"#
    );
}

#[tokio::test]
async fn unmatched_paths_are_rate_limited_too() {
    // The 404 path is the one an unauthenticated scanner generates by default,
    // and it used to be the one path with no rate limit on it at all: the
    // limiter was a `route_layer`, and an unmatched path matched nothing.
    let stack = common::TestStack::start(true, |config: &mut Config| {
        config.rate_limit_per_ip_rps = 2;
    })
    .await;
    let client = reqwest::Client::new();
    let url = format!("{}/wp-admin/setup.php", stack.base_url);

    assert_eq!(client.get(&url).send().await.unwrap().status(), StatusCode::NOT_FOUND);
    assert_eq!(client.get(&url).send().await.unwrap().status(), StatusCode::NOT_FOUND);
    let response = client.get(&url).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        response.text().await.unwrap(),
        r#"{"message":"Too Many Requests","error":"Too Many Requests","statusCode":429}"#
    );
}

#[tokio::test]
async fn cache_fail_open_without_valkey() {
    let stack = common::TestStack::start(false, |_| {}).await;
    let response = reqwest::get(format!("{}/products", stack.base_url)).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["x-cache"], "miss");
}

#[tokio::test]
async fn degraded_shapes_while_the_database_is_down() {
    let stack = common::UnreachableDbStack::start().await;
    let client = reqwest::Client::new();

    let response = client.get(format!("{}/health", stack.base_url)).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let health: Value = response.json().await.unwrap();
    assert_eq!(health["status"], "error");
    assert_eq!(health["error"]["database"]["status"], "down");
    assert!(health["error"]["database"]["message"].as_str().is_some_and(|m| !m.is_empty()));
    assert!(health["info"]["database"].is_null());

    // Reads fall back to the generic unhandled-exception body instead of
    // leaking the driver's error text to clients.
    let response = client.get(format!("{}/products", stack.base_url)).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        response.text().await.unwrap(),
        r#"{"statusCode":500,"message":"Internal server error"}"#
    );
}

/// Reads are routed to the replica while the primary stays the health target.
/// The replica database holds a row the primary does not, which is what makes
/// the routing observable rather than assumed.
#[tokio::test]
async fn reads_are_served_from_the_read_replica() {
    let (stack, replica) = common::TestStack::start_with_read_replica(true, |_| {}).await;
    let client = reqwest::Client::new();

    // Present only in the replica database: a 200 proves `find_by_id` used the
    // read pool.
    let response = client
        .get(format!("{}/products/{}", stack.base_url, common::REPLICA_ONLY_ID))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let detail: Value = response.json().await.unwrap();
    assert_eq!(detail["id"], common::REPLICA_ONLY_ID);
    assert_eq!(detail["price"], 424.25);

    // The same has to hold for the paged read and its `COUNT(*)`: the replica
    // carries the 26 fixtures plus the marker, the primary only the fixtures.
    let response = client.get(format!("{}/products", stack.base_url)).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let page: Value = response.json().await.unwrap();
    assert_eq!(page["total"], 27);
    assert_eq!(page["items"].as_array().unwrap().len(), 20);

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM \"Product\"")
        .fetch_one(&replica.pool)
        .await
        .unwrap();
    assert_eq!(count, 27, "the replica is what the response total reflects");
}

/// The flip side: `/health` must keep reporting on the primary, or a reachable
/// replica would mask a dead primary. A read pool that cannot connect makes the
/// direction unambiguous — reads fail, health does not.
#[tokio::test]
async fn health_checks_the_primary_even_when_reads_target_the_replica() {
    let stack = common::TestStack::start(false, |_| {}).await;
    let base_url = stack
        .serve_with_store(Arc::new(SqlProductStore::with_read_replica(
            stack.pool.clone(),
            common::TestStack::broken_read_pool(),
        )))
        .await;
    let client = reqwest::Client::new();

    let response = client.get(format!("{base_url}/health")).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let health: Value = response.json().await.unwrap();
    assert_eq!(health["status"], "ok", "ping must not touch the read pool");

    // The same store does route reads to the replica, which is why they fail.
    let response = client.get(format!("{base_url}/products")).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

/// An unreachable replica degrades to primary reads rather than a dead service.
#[tokio::test]
async fn an_unreachable_replica_reads_from_the_primary() {
    let stack = common::TestStack::start(true, |config: &mut Config| {
        // Port 1 on loopback refuses immediately, and `connect_read_replica`
        // is fail-open, so the store ends up with no read pool at all.
        config.database_read_url = Some("postgresql://rnw:rnw@127.0.0.1:1/rnw_replica".to_string());
    })
    .await;
    let client = reqwest::Client::new();

    let response = client.get(format!("{}/products/prod-1", stack.base_url)).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let detail: Value = response.json().await.unwrap();
    assert_eq!(detail["id"], "prod-1");
}
