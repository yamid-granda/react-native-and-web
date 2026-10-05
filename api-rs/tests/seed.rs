//! The dev/test split, asserted at the database boundary.
//!
//! The marketplace is meant to hold only what sellers create through the API, so
//! `db:seed` must write no products at all — and the e2e fixture products must be
//! addable and removable without disturbing anything real. Those two halves are
//! only a decision in prose until something checks them, which is this file.

mod common;

use api_rs::seed;
use common::TestStack;
use sqlx::PgPool;

/// `db:seed`, the dev path: accounts only, so a fresh `pnpm dev` shows the empty
/// marketplace state and every product on it was created through the app.
#[tokio::test]
async fn the_dev_seed_writes_the_seller_and_no_products() {
    let stack = empty_database().await;

    seed::run(&stack.pool).await.expect("seed the demo seller");

    assert_eq!(products(&stack.pool).await, 0, "db:seed must not write products");
    assert_eq!(sellers(&stack.pool).await, 1, "the demo seller is what a developer logs in as");
}

/// `seed-fixtures` plus `clear-fixtures`, the e2e path: the fixtures have to go in
/// so the specs that click `prod-1` can run, and back out again afterwards without
/// taking a seller's own product with them.
#[tokio::test]
async fn the_fixture_products_go_in_and_come_back_out_again() {
    let stack = empty_database().await;

    seed::seed_fixtures(&stack.pool).await.expect("seed the fixtures");
    assert_eq!(products(&stack.pool).await, 9);
    assert!(
        product_exists(&stack.pool, "prod-1").await,
        "prod-1 is what the marketplace spec clicks"
    );

    // Upsert, so a second seed-fixtures does not duplicate the catalogue.
    seed::seed_fixtures(&stack.pool).await.expect("re-seed the fixtures");
    assert_eq!(products(&stack.pool).await, 9, "re-seeding must stay idempotent");

    // A product that came through the API, standing in for whatever the developer
    // has been selling locally.
    insert_product(&stack.pool, "real-1").await;

    let removed = seed::clear_fixtures(&stack.pool).await.expect("clear the fixtures");
    assert_eq!(removed, 9);
    assert_eq!(products(&stack.pool).await, 1, "only the created product is left");
    assert!(
        product_exists(&stack.pool, "real-1").await,
        "clear-fixtures must not touch a product a seller created"
    );
    assert_eq!(
        sellers(&stack.pool).await,
        1,
        "clear-fixtures deletes products, never the seller they belonged to"
    );

    // Idempotent too: a teardown that runs when nothing was seeded is a no-op
    // rather than an error, so a re-run never has to know what the last one did.
    assert_eq!(seed::clear_fixtures(&stack.pool).await.expect("clear again"), 0);
}

/// The harness preloads its own products *and* its own seller, and the products
/// overlap the fixture ids. This suite is about what the seed commands write, so
/// start from a database with neither.
async fn empty_database() -> TestStack {
    let stack = TestStack::start(false, |_| {}).await;
    // Products first: `Product.ownerId` references the seller.
    sqlx::query(r#"DELETE FROM "Product""#)
        .execute(&stack.pool)
        .await
        .expect("empty the catalogue");
    sqlx::query(r#"DELETE FROM "User""#).execute(&stack.pool).await.expect("empty the sellers");
    stack
}

async fn insert_product(pool: &PgPool, id: &str) {
    sqlx::query(
        r#"INSERT INTO "Product" ("id", "title", "price", "currency", "stock", "createdAt")
           VALUES ($1, 'Created through the app', 10, 'USD', 1, now())"#,
    )
    .bind(id)
    .execute(pool)
    .await
    .expect("insert a product");
}

// sqlx 0.9 only accepts a `&'static str` here without an explicit injection
// audit, so these are literals rather than one `count` helper taking a table name.
async fn products(pool: &PgPool) -> i64 {
    sqlx::query_scalar(r#"SELECT count(*) FROM "Product""#)
        .fetch_one(pool)
        .await
        .expect("count products")
}

async fn sellers(pool: &PgPool) -> i64 {
    sqlx::query_scalar(r#"SELECT count(*) FROM "User""#)
        .fetch_one(pool)
        .await
        .expect("count sellers")
}

async fn product_exists(pool: &PgPool, id: &str) -> bool {
    sqlx::query_scalar(r#"SELECT EXISTS(SELECT 1 FROM "Product" WHERE "id" = $1)"#)
        .bind(id)
        .fetch_one(pool)
        .await
        .expect("look the product up")
}
