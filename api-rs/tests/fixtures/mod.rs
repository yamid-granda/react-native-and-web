//! Where the byte-compared goldens come from.
//!
//! The seven success-path files beside this module used to be written by a
//! `tests/fixtures/generate_goldens.py` — a second, independent implementation
//! of the response contract, in another language, that no task, hook or test in
//! the repository ever ran. Every field order, envelope shape, sort key and
//! number spelling was therefore spelled twice, and only the Rust spelling was
//! exercised.
//!
//! The rows themselves come from `api-rs/fixtures/products.json`, which is also
//! what `src/seed.rs` reads — one catalogue, so the database a browser drives and
//! the database these goldens were generated from cannot describe different
//! products.
//!
//! These builders replace it. Each one builds its body from the struct the
//! handler actually serializes, so key order, `js_number` and `prisma_datetime`
//! cannot drift from the code that produces them, and `parse_page` supplies the
//! page size rather than a hardcoded `20`. `common::fixture_products` is the one
//! fixture→`Product` conversion, shared with the rows the E2E harness seeds.
//!
//! The committed files remain the reviewed expectation, and `assert_golden`
//! remains the check that the *server* matches them. `parity.rs` adds only that
//! they are also *derivable* — neither check replaces the other.
//!
//! The five failure and health goldens are deliberately absent. Their content
//! *is* the contract, so deriving them from `AppError::body` or the health
//! struct would turn them into a restatement of the code they exist to pin.
//!
//! A module rather than `tests/fixtures.rs`: Cargo would take a top-level
//! `tests/*.rs` as a test binary of its own, and this one is a helper for
//! `parity.rs` that needs no harness of its own.

use serde::Serialize;

use api_rs::handlers::products::{parse_page, ProductJson, ProductsByIdsJson, ProductsPageJson};
use api_rs::handlers::stores::StoreJson;
use api_rs::store::{Product, PAGE_SIZE};

use crate::common::{
    fixture_products, parse_timestamp, FIXTURE_STORE_CREATED_AT, FIXTURE_STORE_ID,
    FIXTURE_STORE_NAME,
};

/// The ids the batch golden is asked for, in the order `parity.rs` asks the
/// server for them.
///
/// `items` comes back in *requested* order so a client can zip it onto its own
/// list, and `missing` holds the id the server never had. Two rows on purpose —
/// one of them owned, so `storeId` and `storeName` are proven to survive being
/// read through a batch rather than only through `/products/{id}` — and one
/// absent id, so `missing` is pinned as a populated result instead of an empty
/// list that happens to look right.
const BATCH_IDS: [&str; 3] = ["prod-1", "does-not-exist", "prod-owned-1"];

/// Every derived golden, as `(file name, body)`.
///
/// One list so the derivation check and the regeneration writer cannot disagree
/// about which files are derived: adding a golden means adding it here.
pub fn derived_goldens() -> Vec<(&'static str, String)> {
    let products = fixture_products();
    let owned = owned_by(&products);

    vec![
        ("products-page-1.json", page_json(&products, 1)),
        ("products-page-2.json", page_json(&products, 2)),
        ("product-prod-1.json", product_json(find(&products, "prod-1"))),
        ("product-prod-owned-1.json", product_json(find(&products, "prod-owned-1"))),
        ("products-by-ids.json", batch_json(&products)),
        // The storefront page: the same envelope over one seller's rows. Its own
        // golden because `/stores/{id}/products` builds that envelope on a route
        // of its own.
        ("store-products-fixture.json", page_json(&owned, 1)),
        ("store-fixture.json", store_json()),
    ]
}

fn body<T: Serialize>(value: &T) -> String {
    serde_json::to_string(value).expect("the wire structs always serialize")
}

fn find<'a>(products: &'a [Product], id: &str) -> &'a Product {
    products
        .iter()
        .find(|product| product.id == id)
        .unwrap_or_else(|| panic!("fixture row {id} is missing from products.json"))
}

/// One seller's rows, already in `LIST_QUERY` order because `owned_by` filters
/// that list rather than re-sorting it.
fn owned_by(products: &[Product]) -> Vec<Product> {
    products
        .iter()
        .filter(|product| product.owner_id.as_deref() == Some(FIXTURE_STORE_ID))
        .cloned()
        .collect()
}

fn product_json(product: &Product) -> String {
    body(&ProductJson::from(product.clone()))
}

/// `?page=N` of `rows`, through the production envelope.
///
/// `rows` is already sorted the way `LIST_QUERY` sorts, so the page boundary
/// here is the one Postgres draws. `limit` and `hasNextPage` come out of
/// `ProductsPageJson::from_page` rather than being restated.
fn page_json(rows: &[Product], page: usize) -> String {
    let query = parse_page(Some(&format!("page={page}"))).expect("a plain page number parses");
    let offset = query.offset as usize;
    let start = offset.min(rows.len());
    let end = start.saturating_add(PAGE_SIZE as usize).min(rows.len());

    body(&ProductsPageJson::from_page(rows[start..end].to_vec(), &query, rows.len() as i64))
}

fn batch_json(products: &[Product]) -> String {
    let mut items = Vec::new();
    let mut missing = Vec::new();
    for id in BATCH_IDS {
        match products.iter().find(|product| product.id == id) {
            Some(product) => items.push(ProductJson::from(product.clone())),
            None => missing.push(id.to_string()),
        }
    }

    body(&ProductsByIdsJson { items, missing })
}

fn store_json() -> String {
    body(&StoreJson {
        id: FIXTURE_STORE_ID.to_string(),
        store_name: FIXTURE_STORE_NAME.to_string(),
        created_at: parse_timestamp(FIXTURE_STORE_CREATED_AT),
    })
}
