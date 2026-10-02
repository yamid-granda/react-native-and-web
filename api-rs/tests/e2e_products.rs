mod common;

use reqwest::StatusCode;
use serde_json::Value;

use api_rs::config::Config;

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
    assert_eq!(page_one["total"], 25);
    assert_eq!(page_one["hasNextPage"], true);
    assert_eq!(page_one["items"][0]["id"], "prod-1");
    assert_eq!(page_one["items"][0]["price"], 129.99);

    let response = client.get(format!("{}/products?page=2", stack.base_url)).send().await.unwrap();
    let page_two: Value = response.json().await.unwrap();
    assert_eq!(page_two["items"].as_array().unwrap().len(), 5);
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

    // Reads fall back to Nest's unhandled-exception body instead of leaking
    // the driver's error text to clients.
    let response = client.get(format!("{}/products", stack.base_url)).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        response.text().await.unwrap(),
        r#"{"statusCode":500,"message":"Internal server error"}"#
    );
}
