mod common;

use reqwest::{Client, StatusCode};

fn normalize_health(mut body: String) -> String {
    let marker = "\"responseTime\":";
    let mut from = 0;
    while let Some(relative) = body[from..].find(marker) {
        let start = from + relative + marker.len();
        let end = body[start..]
            .find(|c: char| !c.is_ascii_digit())
            .map(|relative| start + relative)
            .unwrap_or(body.len());
        body.replace_range(start..end, "0");
        from = start + 1;
    }
    body
}

async fn assert_golden(client: &Client, base: &str, path: &str, status: StatusCode, golden: &str) {
    let response = client.get(format!("{base}{path}")).send().await.unwrap();
    assert_eq!(response.status(), status, "{path}");
    let body = response.text().await.unwrap();
    assert_eq!(body, golden, "{path} response body differed from golden fixture");
}

#[tokio::test]
async fn responses_match_committed_golden_fixtures() {
    let stack = common::TestStack::start(true, |_| {}).await;
    let client = Client::new();

    assert_golden(
        &client,
        &stack.base_url,
        "/products?page=1",
        StatusCode::OK,
        include_str!("fixtures/products-page-1.json"),
    )
    .await;
    assert_golden(
        &client,
        &stack.base_url,
        "/products?page=2",
        StatusCode::OK,
        include_str!("fixtures/products-page-2.json"),
    )
    .await;
    assert_golden(
        &client,
        &stack.base_url,
        "/products/prod-1",
        StatusCode::OK,
        include_str!("fixtures/product-prod-1.json"),
    )
    .await;
    // The one fixture with a seller: proves the store `LEFT JOIN` fills
    // `storeId`/`storeName` rather than leaving them null everywhere.
    assert_golden(
        &client,
        &stack.base_url,
        "/products/prod-owned-1",
        StatusCode::OK,
        include_str!("fixtures/product-prod-owned-1.json"),
    )
    .await;
    assert_golden(
        &client,
        &stack.base_url,
        &format!("/stores/{}", common::FIXTURE_STORE_ID),
        StatusCode::OK,
        include_str!("fixtures/store-fixture.json"),
    )
    .await;
    assert_golden(
        &client,
        &stack.base_url,
        "/products/does-not-exist",
        StatusCode::NOT_FOUND,
        include_str!("fixtures/product-404.json"),
    )
    .await;
    assert_golden(
        &client,
        &stack.base_url,
        "/nope?x=1",
        StatusCode::NOT_FOUND,
        include_str!("fixtures/route-404.json"),
    )
    .await;
    assert_golden(
        &client,
        &stack.base_url,
        "/auth/me",
        StatusCode::UNAUTHORIZED,
        include_str!("fixtures/unauthorized-401.json"),
    )
    .await;

    let response = client.get(format!("{}/products?page=-1", stack.base_url)).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(response.text().await.unwrap(), include_str!("fixtures/internal-500.json"));

    let response = client.get(format!("{}/health", stack.base_url)).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        normalize_health(response.text().await.unwrap()),
        include_str!("fixtures/health-up.json")
    );
}
