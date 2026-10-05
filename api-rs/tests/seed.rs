//! The dev/test split, asserted at the database boundary.
//!
//! The marketplace is meant to hold only what sellers create through the API, so
//! `db:seed` must write no products at all — and the e2e fixture products must be
//! addable and removable without disturbing anything real. Those two halves are
//! only a decision in prose until something checks them, which is this file.

mod common;

use api_rs::seed;
use chrono::NaiveDateTime;
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

/// The mirror of `parity.rs`'s derivation check, for the other direction and the
/// other database.
///
/// `db:seed-fixtures` and the E2E harness describe the same nine products from
/// the same committed catalogue, so what lands in the database has to be the
/// catalogue's rows — not a second hand-maintained spelling of them that only the
/// two e2e suites that quote a price out loud could notice. Before the catalogue
/// had one owner, editing `prod-1`'s price in `seed.rs` was caught by exactly
/// those two suites; it is caught here now.
#[tokio::test]
async fn the_seeded_rows_hold_the_catalogues_values() {
    let stack = empty_database().await;

    seed::seed_fixtures(&stack.pool).await.expect("seed the fixtures");

    let rows: Vec<StoredProduct> = sqlx::query_as(
        r#"SELECT "id", "title", "description", "price", "imageUrl", "stock", "ownerId"
                           FROM "Product" ORDER BY "id" COLLATE "C""#,
    )
    .fetch_all(&stack.pool)
    .await
    .expect("read the seeded products");

    let catalogue = catalogue();
    assert_eq!(rows.len(), 9, "the seed path writes the nine ids the specs target");

    for stored in &rows {
        let expected = catalogue
            .iter()
            .find(|row| row.id == stored.id)
            .unwrap_or_else(|| panic!("{} is seeded but absent from the catalogue", stored.id));

        assert_eq!(stored.title, expected.title, "{} title", stored.id);
        assert_eq!(stored.description, expected.description, "{} description", stored.id);
        assert_eq!(stored.price, expected.price, "{} price", stored.id);
        assert_eq!(stored.image_url, expected.image_url, "{} image", stored.id);
        assert_eq!(stored.stock, expected.stock, "{} stock", stored.id);
    }

    // The seeded catalogue belongs to the demo seller, not to the harness's own
    // fixture seller the catalogue names — the override `seed.rs` declares has to
    // survive the round trip through the database too.
    let owned: Vec<&StoredProduct> = rows.iter().filter(|row| row.owner_id.is_some()).collect();
    assert_eq!(owned.len(), 1);
    assert_eq!(owned[0].id, "prod-owned-1");
    assert_eq!(owned[0].owner_id.as_deref(), Some(seed::DEMO_SELLER_ID));

    // The one field the two databases deliberately stamp differently: the
    // catalogue pins `createdAt` because a golden needs a fixed byte, and
    // `upsert_fixture` leaves the column to the schema default so a developer's
    // catalogue looks freshly created. Asserted rather than left as an accident
    // of the insert's column list.
    let prod_owned = catalogue.iter().find(|row| row.id == "prod-owned-1").expect("prod-owned-1");
    let stored_created_at: NaiveDateTime =
        sqlx::query_scalar(r#"SELECT "createdAt" FROM "Product" WHERE "id" = 'prod-owned-1'"#)
            .fetch_one(&stack.pool)
            .await
            .expect("read the stored createdAt");

    assert_ne!(
        stored_created_at,
        chrono::NaiveDateTime::parse_from_str(&prod_owned.created_at, "%Y-%m-%d %H:%M:%S%.3f")
            .expect("the catalogue's committed timestamp parses"),
        "db:seed-fixtures must stamp createdAt itself rather than take the catalogue's"
    );
}

/// A seeded row as the database returns it, for the comparison above.
///
/// `sqlx::FromRow` matches Rust field names against column names, and this
/// schema's are Prisma's quoted camelCase, so the mapping is spelled out rather
/// than derived.
#[derive(sqlx::FromRow)]
struct StoredProduct {
    #[sqlx(rename = "id")]
    id: String,
    #[sqlx(rename = "title")]
    title: String,
    #[sqlx(rename = "description")]
    description: Option<String>,
    #[sqlx(rename = "price")]
    price: f64,
    #[sqlx(rename = "imageUrl")]
    image_url: Option<String>,
    #[sqlx(rename = "stock")]
    stock: i32,
    #[sqlx(rename = "ownerId")]
    owner_id: Option<String>,
}

/// The committed catalogue, parsed in this crate rather than reaching into the
/// library's private copy: the file is the owner, and this test asserts against
/// the file the way a reviewer reads it.
fn catalogue() -> Vec<CatalogueRow> {
    serde_json::from_str(include_str!("../fixtures/products.json"))
        .expect("fixtures/products.json parses")
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogueRow {
    id: String,
    title: String,
    description: Option<String>,
    price: f64,
    image_url: Option<String>,
    stock: i32,
    created_at: String,
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
