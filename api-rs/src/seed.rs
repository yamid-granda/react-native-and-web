use serde::Deserialize;
use sqlx::PgPool;

struct SeedProduct {
    id: String,
    title: String,
    description: Option<String>,
    price: f64,
    image_url: Option<String>,
    stock: i32,
    owner_id: Option<String>,
}

/// The committed catalogue, embedded at compile time like the migrations in
/// [`crate::migrations`] rather than read from disk, so `db:seed-fixtures`
/// behaves the same whatever working directory the pnpm script hands it.
const CATALOGUE: &str = include_str!("../fixtures/products.json");

/// A row of `fixtures/products.json` as the file spells it.
///
/// Three of its nine fields are accepted and then deliberately not used, which is
/// the whole point of reading the catalogue rather than keeping a copy: the file
/// is the owner of what a fixture *is*, so a new field in it is a fact about the
/// catalogue rather than something this struct has to be taught. `currency` and
/// `createdAt` are named with a leading underscore because only the tests read
/// them — the insert hardcodes `'USD'` and leaves `createdAt` to the schema
/// default, both asserted in the test module. `owner_id` is the catalogue's value
/// that this path *replaces* through [`owner_for`], so it is read only to prove
/// the override is still real.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogueProduct {
    id: String,
    title: String,
    description: Option<String>,
    price: f64,
    image_url: Option<String>,
    stock: i32,
    #[cfg_attr(not(test), allow(dead_code))]
    owner_id: Option<String>,
    #[cfg_attr(not(test), allow(dead_code))]
    _currency: String,
    #[cfg_attr(not(test), allow(dead_code))]
    _created_at: String,
}

/// The subset of [`CATALOGUE`] the platform e2e suites target.
///
/// A deliberate subset: the seventeen `prod-gen-*` rows exist to make page two
/// and the `total` count interesting for the Rust harness, and a developer's
/// database has no reason to hold them. Everything else — title, description,
/// price, image, stock — is the catalogue's, not this file's.
const E2E_FIXTURE_IDS: [&str; 9] = [
    "prod-1",
    "prod-2",
    "prod-3",
    "prod-4",
    "prod-5",
    "prod-6",
    "prod-7",
    "prod-8",
    "prod-owned-1",
];

/// The rows [`seed_fixtures`] writes and nothing else: fixed ids so both
/// platforms' e2e specs can target a known product, and so re-seeding is
/// idempotent. `prod-1` is clicked by the web marketplace spec.
///
/// The values are [`CATALOGUE`]'s, which is also what the hermetic E2E harness
/// and the byte-compared goldens are derived from — so the database a browser
/// drives and the database a golden was generated from cannot describe different
/// products. The two differences between them are named here rather than
/// hand-maintained: which rows ([`E2E_FIXTURE_IDS`]) and who owns the owned one
/// ([`owner_for`]).
fn fixture_products() -> Vec<SeedProduct> {
    catalogue()
        .into_iter()
        .filter(|product| E2E_FIXTURE_IDS.contains(&product.id.as_str()))
        .map(|product| SeedProduct {
            owner_id: owner_for(&product.id),
            id: product.id,
            title: product.title,
            description: product.description,
            price: product.price,
            image_url: product.image_url,
            stock: product.stock,
        })
        .collect()
}

/// [`CATALOGUE`], parsed.
///
/// Exposed so the tests below compare against the committed file rather than
/// against this file's own transformation of it.
fn catalogue() -> Vec<CatalogueProduct> {
    serde_json::from_str(CATALOGUE).expect("fixtures/products.json parses")
}

/// The one override, and the reason it is an override rather than a second copy.
///
/// [`CATALOGUE`] gives `prod-owned-1` to `FIXTURE_STORE_ID`, the seller the
/// hermetic harness inserts so its `LEFT JOIN` resolves — a row created at
/// runtime with a deliberately unusable password hash, so that id is meaningful
/// only inside the harness. A developer's seeded catalogue belongs to
/// [`DEMO_SELLER_ID`] instead, because the whole point of that seller is that
/// `seller@rnw.test` can log in and find the product in My Store.
fn owner_for(id: &str) -> Option<String> {
    (id == "prod-owned-1").then(|| DEMO_SELLER_ID.to_string())
}

/// The demo seller behind `prod-owned-1`.
///
/// A real password hash, so `POST /auth/login` works against a fresh `db:seed`
/// without registering first. Deliberately cheap argon2 parameters: this is
/// development fixture data with a published password, and a hash at production
/// cost would make every local login pay for nothing. It is a *seller*, never a
/// session — no session row is seeded, because a seeded token would be a live
/// credential in every developer's database.
pub const DEMO_SELLER_ID: &str = "usr_demo_seller";
pub const DEMO_SELLER_EMAIL: &str = "seller@rnw.test";
pub const DEMO_SELLER_PASSWORD: &str = "rnw-demo-password";
pub const DEMO_STORE_NAME: &str = "Riverbend Vintage";

#[derive(Debug)]
struct SeedSeller {
    id: &'static str,
    email: &'static str,
    password_hash: String,
    store_name: &'static str,
}

fn demo_sellers() -> Vec<SeedSeller> {
    let hasher = argon2::Argon2::from(seed_params());
    vec![SeedSeller {
        id: DEMO_SELLER_ID,
        email: DEMO_SELLER_EMAIL,
        password_hash: argon2::PasswordHasher::hash_password(
            &hasher,
            DEMO_SELLER_PASSWORD.as_bytes(),
        )
        .expect("the demo password always hashes")
        .to_string(),
        store_name: DEMO_STORE_NAME,
    }]
}

fn seed_params() -> argon2::Params {
    // m=64 KiB, t=1, p=1 — see the note on `DEMO_SELLER_PASSWORD`.
    argon2::Params::new(64, 1, 1, None).expect("cheap seed params are valid")
}

/// How many rows [`run`] upserts, so `api-rs-db` can report a number it did not
/// hardcode and drift from.
pub fn seller_count() -> usize {
    demo_sellers().len()
}

/// How many rows [`seed_fixtures`] upserts, [`run`]'s rows included.
pub fn fixture_count() -> usize {
    fixture_products().len() + demo_sellers().len()
}

/// Upserts the demo seller and nothing else, so a developer's marketplace holds
/// only what sellers create through the app. Products for the platform e2e specs
/// come from [`seed_fixtures`], never from here.
pub async fn run(pool: &PgPool) -> Result<(), sqlx::Error> {
    for seller in demo_sellers() {
        upsert_seller(pool, &seller).await?;
    }

    Ok(())
}

/// [`run`], plus the fixed products both platforms' e2e specs target. Explicitly
/// a test-data path: it writes the fixture catalogue into whichever database
/// `DATABASE_URL` points at, so pair it with [`clear_fixtures`].
pub async fn seed_fixtures(pool: &PgPool) -> Result<(), sqlx::Error> {
    run(pool).await?;

    for product in fixture_products() {
        upsert_fixture(pool, &product).await?;
    }

    Ok(())
}

/// Deletes exactly the rows [`seed_fixtures`] wrote, leaving sellers and anything
/// created through the API alone — the point of the pair is that a dev database
/// is back to real data only once a test run has finished. Returns how many rows
/// went, so a second call reports zero rather than pretending to have cleaned up.
pub async fn clear_fixtures(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let ids: Vec<String> = fixture_products().into_iter().map(|product| product.id).collect();
    let deleted = sqlx::query(r#"DELETE FROM "Product" WHERE "id" = ANY($1)"#)
        .bind(&ids)
        .execute(pool)
        .await?
        .rows_affected();

    Ok(deleted)
}

/// Upsert, so a re-seed updates the stored hash whenever the password or the
/// argon2 parameters change — a hash is not something to leave behind.
async fn upsert_seller(pool: &PgPool, seller: &SeedSeller) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO "User" ("id", "email", "passwordHash", "storeName")
           VALUES ($1, $2, $3, $4)
           ON CONFLICT ("id") DO UPDATE SET
             "email" = EXCLUDED."email",
             "passwordHash" = EXCLUDED."passwordHash",
             "storeName" = EXCLUDED."storeName""#,
    )
    .bind(seller.id)
    .bind(seller.email)
    .bind(&seller.password_hash)
    .bind(seller.store_name)
    .execute(pool)
    .await?;

    Ok(())
}

/// Upsert, so a re-seed updates a stored value when the catalogue changes.
///
/// `createdAt` is deliberately absent from the column list. The catalogue pins
/// it because a byte-compared golden needs a fixed timestamp, but a developer's
/// catalogue should look like it was just created — so the insert takes the
/// schema default (`CURRENT_TIMESTAMP`) and the `ON CONFLICT` clause leaves an
/// existing stamp alone, which keeps re-seeding idempotent. That divergence is
/// asserted from both sides: [`tests::created_at_is_the_databases_policy_not_the
/// catalogues`] here, and against the stored rows in `tests/seed.rs`.
/// The statement [`upsert_fixture`] runs, as a const so the test below can read
/// the real column list rather than a copy of it.
const UPSERT_FIXTURE: &str = r#"INSERT INTO "Product" ("id", "title", "description", "price", "currency", "imageUrl", "stock", "ownerId")
           VALUES ($1, $2, $3, $4, 'USD', $5, $6, $7)
           ON CONFLICT ("id") DO UPDATE SET
             "title" = EXCLUDED."title",
             "description" = EXCLUDED."description",
             "price" = EXCLUDED."price",
             "currency" = EXCLUDED."currency",
             "imageUrl" = EXCLUDED."imageUrl",
             "stock" = EXCLUDED."stock",
             "ownerId" = EXCLUDED."ownerId""#;

async fn upsert_fixture(pool: &PgPool, product: &SeedProduct) -> Result<(), sqlx::Error> {
    sqlx::query(UPSERT_FIXTURE)
        .bind(&product.id)
        .bind(&product.title)
        .bind(&product.description)
        .bind(product.price)
        .bind(&product.image_url)
        .bind(product.stock)
        .bind(&product.owner_id)
        .execute(pool)
        .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The gate that was missing: every row `db:seed-fixtures` writes is the
    /// committed catalogue's row, field for field.
    ///
    /// The assertions this replaces proved `fixture_products()` equalled itself —
    /// every value they checked was written a few lines above them in the same
    /// file — so they moved with any edit and could not fail. These read
    /// [`CATALOGUE`], which is the *other* description of these rows, so a price
    /// changed in one place and not the other is caught here instead of by
    /// whichever Playwright or Detox suite happens to run.
    #[test]
    fn every_seeded_row_is_the_catalogues_row_unmodified() {
        let seeded = fixture_products();
        let catalogue = catalogue();

        assert_eq!(seeded.len(), E2E_FIXTURE_IDS.len());

        for product in &seeded {
            let expected = catalogue.iter().find(|row| row.id == product.id).unwrap_or_else(|| {
                panic!("{} is seeded but absent from the catalogue", product.id)
            });

            assert_eq!(product.title, expected.title, "{} title", product.id);
            assert_eq!(product.description, expected.description, "{} description", product.id);
            assert_eq!(product.price, expected.price, "{} price", product.id);
            assert_eq!(product.image_url, expected.image_url, "{} image", product.id);
            assert_eq!(product.stock, expected.stock, "{} stock", product.id);
        }
    }

    /// The null image and null description stay null, because both platforms'
    /// specs render those paths and would otherwise only be covered by the
    /// harness. Asserted here rather than dropped: nothing else in this file
    /// would notice the catalogue gaining an image on `prod-5`.
    #[test]
    fn the_null_image_and_description_paths_are_still_covered() {
        let seeded = fixture_products();
        let image_null: Vec<_> =
            seeded.iter().filter(|p| p.image_url.is_none()).map(|p| &p.id).collect();
        let description_null: Vec<_> =
            seeded.iter().filter(|p| p.description.is_none()).map(|p| &p.id).collect();

        assert_eq!(image_null, ["prod-5", "prod-7"]);
        assert_eq!(description_null, ["prod-7"]);
    }

    /// The filter is a decision, so it is pinned: no row outside
    /// [`E2E_FIXTURE_IDS`] reaches a developer's database, and no row inside it
    /// is silently skipped by a typo in the id list.
    #[test]
    fn only_the_ids_the_platform_specs_target_are_seeded() {
        let products = fixture_products();
        let seeded: Vec<&str> = products.iter().map(|p| p.id.as_str()).collect();

        assert_eq!(seeded, E2E_FIXTURE_IDS);
    }

    /// The catalogue is 26 rows and the seed path writes 9 of them. Asserted so
    /// growing either side is a deliberate change to a named constant rather than
    /// a side effect of adding a fixture.
    #[test]
    fn the_seed_path_takes_a_subset_of_the_catalogue() {
        assert_eq!(catalogue().len(), 26);
        assert_eq!(fixture_products().len(), 9);
    }

    /// Exactly one seller-scoped row, so a fresh database has one product for the
    /// storefront and My Store paths to find, and it belongs to the seller a
    /// developer can log in as.
    ///
    /// The second half is the point: the catalogue names a *different* seller for
    /// `prod-owned-1`, so this asserts the override is real and has not quietly
    /// become a second copy of the row.
    #[test]
    fn the_one_owned_fixture_belongs_to_the_demo_seller() {
        let owned: Vec<_> =
            fixture_products().into_iter().filter(|p| p.owner_id.is_some()).collect();

        assert_eq!(owned.len(), 1);
        assert_eq!(owned[0].id, "prod-owned-1");
        assert_eq!(owned[0].owner_id.as_deref(), Some(DEMO_SELLER_ID));

        let catalogue_owner = catalogue()
            .into_iter()
            .find(|row| row.id == "prod-owned-1")
            .expect("prod-owned-1 is in the catalogue")
            .owner_id;

        assert_eq!(
            catalogue_owner.as_deref(),
            Some("usr_fixture_store"),
            "the catalogue names the harness's own seller, which is why owner_for overrides it"
        );
    }

    /// The two databases genuinely do stamp `createdAt` differently, so the
    /// omission in [`upsert_fixture`] is a stated policy rather than an accident
    /// of its column list. The catalogue pins every row; a developer's row is
    /// stamped by the schema instead.
    #[test]
    fn created_at_is_the_databases_policy_not_the_catalogues() {
        let catalogue = catalogue();
        let pinned: Vec<&str> = catalogue
            .iter()
            .filter(|row| row._created_at.is_empty())
            .map(|row| row.id.as_str())
            .collect();

        assert!(pinned.is_empty(), "the catalogue pins every row's createdAt: {pinned:?}");

        // `upsert_fixture` omits the column entirely, so a fresh insert takes the
        // schema default and a re-seed leaves the original stamp. Both halves of
        // that claim are checkable here only as far as the SQL; the stored
        // result is asserted in `tests/seed.rs`.
        assert!(
            !upsert_query().contains("createdAt"),
            "upsert_fixture must keep leaving createdAt to the schema default"
        );
    }

    /// The column list, so the assertion above reads the real statement instead of
    /// a copy of it that a future edit to [`upsert_fixture`] would not move.
    fn upsert_query() -> &'static str {
        UPSERT_FIXTURE
    }

    #[test]
    fn the_demo_seller_hash_is_real_and_matches_the_published_password() {
        let sellers = demo_sellers();
        assert_eq!(sellers.len(), 1);
        let seller = &sellers[0];
        assert_eq!(seller.email, DEMO_SELLER_EMAIL);
        assert_eq!(seller.store_name, DEMO_STORE_NAME);
        assert!(seller.password_hash.starts_with("$argon2id$"), "{}", seller.password_hash);
        assert!(
            crate::auth::password::verify_password(&seller.password_hash, DEMO_SELLER_PASSWORD),
            "the published demo password must actually work"
        );
        assert!(!crate::auth::password::verify_password(&seller.password_hash, "wrong"));
    }

    /// A seeded *session* would be a live credential in every developer's
    /// database, so `run` writes sellers and products only. Asserted by the
    /// absence of any `Session` reference in `demo_sellers`.
    #[test]
    fn the_demo_seller_has_no_session_of_its_own() {
        assert!(!format!("{:?}", demo_sellers()).contains("tokenHash"));
    }

    /// `db:seed` writes accounts only, so the number it prints is sellers and
    /// never products: a dev marketplace holds nothing a seeder put there.
    #[test]
    fn the_dev_seed_counts_sellers_and_no_products() {
        assert_eq!(seller_count(), 1);
    }

    /// `seed-fixtures` is the only path that writes products, so its reported
    /// count has to cover the fixture list plus the seller `prod-owned-1` needs.
    #[test]
    fn the_fixture_seed_counts_the_products_it_writes() {
        assert_eq!(fixture_count(), 10);
    }
}
