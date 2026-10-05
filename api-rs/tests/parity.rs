mod common;
mod fixtures;

use std::fs;
use std::path::{Path, PathBuf};

use reqwest::{Client, StatusCode};

/// Where a derived golden lives. `CARGO_MANIFEST_DIR` rather than a relative
/// path so the tests do not depend on the working directory `cargo test` picks.
fn golden_path(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
}

/// The first place two bodies diverge, with a little context either side of it.
/// A golden is one long line, so `assert_eq!`'s diff on two of them buries the
/// actual difference in a wall of JSON.
///
/// Walked by character rather than by byte so the windows below cannot land
/// inside a multi-byte character, with the reported offset converted back to
/// bytes because that is the number you can paste into an editor.
fn first_difference(left: &str, right: &str) -> String {
    let left: Vec<char> = left.chars().collect();
    let right: Vec<char> = right.chars().collect();
    let at = left
        .iter()
        .zip(&right)
        .position(|(l, r)| l != r)
        .unwrap_or_else(|| left.len().min(right.len()));
    let window = |chars: &[char]| {
        let start = at.saturating_sub(12);
        let end = (at + 24).min(chars.len());
        chars[start..end].iter().collect::<String>()
    };

    format!(
        "byte {} (committed {} bytes, derived {} bytes)\n  committed: …{}…\n  derived:   …{}…",
        left[..at].iter().map(|c| c.len_utf8()).sum::<usize>(),
        left.len(),
        right.len(),
        window(&left),
        window(&right)
    )
}

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
    // The batch lookup, beside the two detail goldens it is assembled from: same
    // bytes per row, `missing` included. It is the wire contract for the three
    // client stores that keep ids instead of snapshots, so the shape is compared
    // byte-for-byte like every other route here.
    assert_golden(
        &client,
        &stack.base_url,
        "/products/by-ids?ids=prod-1,does-not-exist,prod-owned-1",
        StatusCode::OK,
        include_str!("fixtures/products-by-ids.json"),
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
    // The storefront page, next to the store itself: same envelope, one seller's
    // rows. Its own golden because the route builds the body on its own.
    assert_golden(
        &client,
        &stack.base_url,
        &format!("/stores/{}/products", common::FIXTURE_STORE_ID),
        StatusCode::OK,
        include_str!("fixtures/store-products-fixture.json"),
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

/// The seven success goldens must be exactly what the production serializers
/// produce from `products.json`.
///
/// `responses_match_committed_golden_fixtures` proves the *server* agrees with
/// the committed files. This proves the files are not a hand-edited copy of
/// whatever the server did last, which is the gap that let a second,
/// never-executed Python implementation of the contract stand in as the source
/// of these bytes for so long. Together the two checks mean a field added to
/// `ProductJson` cannot go missing from a golden, and a golden cannot be edited
/// to make a failing byte-comparison pass.
#[test]
fn the_success_goldens_are_reproducible_from_the_fixture() {
    for (name, derived) in fixtures::derived_goldens() {
        let path = golden_path(name);
        let committed =
            fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        assert!(
            committed == derived,
            "{} no longer matches what the serializers produce — {}",
            path.display(),
            first_difference(&committed, &derived)
        );
    }
}

/// Rewrites the derived goldens in place.
///
/// Opt-in and `#[ignore]`d because it writes files, and pointed at by
/// `pnpm --filter @rnw/api-rs test:e2e:update-goldens`. Running it on a
/// consistent tree rewrites nothing, which is the point: the generator is
/// reachable from a documented command and idempotent, instead of being a file
/// in Python that nothing knew how to run.
///
/// Run it after changing the contract, then read the diff — the goldens are
/// still reviewed by hand.
#[test]
#[ignore = "writes tests/fixtures/; run it via test:e2e:update-goldens"]
fn rewrite_the_derived_goldens() {
    assert_eq!(
        std::env::var("UPDATE_GOLDENS").as_deref(),
        Ok("1"),
        "this test writes tests/fixtures/ — run \
         `pnpm --filter @rnw/api-rs test:e2e:update-goldens`, which sets UPDATE_GOLDENS=1"
    );

    for (name, derived) in fixtures::derived_goldens() {
        let path = golden_path(name);
        fs::write(&path, derived).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    }
}
