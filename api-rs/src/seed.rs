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

/// The catalogue [`seed_fixtures`] writes and nothing else: fixed ids so both
/// platforms' e2e specs can target a known product, and so re-seeding is
/// idempotent. `prod-1` is clicked by the web marketplace spec.
fn fixture_products() -> Vec<SeedProduct> {
    vec![
        seed(
            "prod-1",
            "Wireless Headphones",
            Some("Noise-cancelling over-ear headphones with 30h battery life."),
            129.99,
            true,
            42,
        ),
        seed(
            "prod-2",
            "Mechanical Keyboard",
            Some("Hot-swappable 75% keyboard with brown switches."),
            89.5,
            true,
            0,
        ),
        seed(
            "prod-3",
            "Ceramic Coffee Mug",
            Some("350ml matte-finish mug, dishwasher safe."),
            18.0,
            true,
            120,
        ),
        seed(
            "prod-4",
            "Running Shoes",
            Some("Lightweight trainers with breathable mesh upper."),
            74.99,
            true,
            2,
        ),
        seed(
            "prod-5",
            "Backpack",
            Some("Water-resistant 20L daypack with laptop sleeve."),
            54.0,
            false,
            15,
        ),
        seed(
            "prod-6",
            "Desk Lamp",
            Some("Dimmable LED lamp with USB-C charging port."),
            32.25,
            true,
            0,
        ),
        seed("prod-7", "Yoga Mat", None, 24.99, false, 3),
        seed(
            "prod-8",
            "Bluetooth Speaker",
            Some("Compact IPX7 speaker, 12h playback."),
            45.0,
            true,
            60,
        ),
        owned_fixture(),
    ]
}

fn seed(
    id: &str,
    title: &str,
    description: Option<&str>,
    price: f64,
    with_image: bool,
    stock: i32,
) -> SeedProduct {
    SeedProduct {
        id: id.to_string(),
        title: title.to_string(),
        description: description.map(str::to_string),
        price,
        image_url: with_image.then(|| format!("https://picsum.photos/seed/{id}/400/400")),
        stock,
        owner_id: None,
    }
}

/// The one product that belongs to a seller, so the `LEFT JOIN` in the read path
/// and the owner-scoped queries are exercisable from a fresh `db:seed`. Fixed id
/// because both platforms' e2e specs target it.
fn owned_fixture() -> SeedProduct {
    SeedProduct {
        id: "prod-owned-1".to_string(),
        title: "Leather Weekender Bag".to_string(),
        description: Some("Hand-stitched full-grain leather, brass hardware.".to_string()),
        price: 189.0,
        image_url: Some("https://picsum.photos/seed/prod-owned-1/400/400".to_string()),
        stock: 6,
        owner_id: Some(DEMO_SELLER_ID.to_string()),
    }
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

async fn upsert_fixture(pool: &PgPool, product: &SeedProduct) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO "Product" ("id", "title", "description", "price", "currency", "imageUrl", "stock", "ownerId")
           VALUES ($1, $2, $3, $4, 'USD', $5, $6, $7)
           ON CONFLICT ("id") DO UPDATE SET
             "title" = EXCLUDED."title",
             "description" = EXCLUDED."description",
             "price" = EXCLUDED."price",
             "currency" = EXCLUDED."currency",
             "imageUrl" = EXCLUDED."imageUrl",
             "stock" = EXCLUDED."stock",
             "ownerId" = EXCLUDED."ownerId""#,
    )
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

    #[test]
    fn fixture_rows_are_the_ones_the_e2e_specs_target() {
        let fixtures = fixture_products();
        assert_eq!(fixtures.len(), 9);
        assert_eq!(fixtures[0].id, "prod-1");
        assert_eq!(fixtures[0].title, "Wireless Headphones");
        assert_eq!(fixtures[0].price, 129.99);
        // prod-5 and prod-7 exist to cover the null image/description paths.
        assert!(fixtures[4].image_url.is_none());
        assert!(fixtures[6].description.is_none());
        // Only the last fixture has an owner, so a fresh database has exactly one
        // seller-scoped row for the storefront and My Store paths to find.
        let owned: Vec<_> = fixtures.iter().filter(|product| product.owner_id.is_some()).collect();
        assert_eq!(owned.len(), 1);
        assert_eq!(owned[0].id, "prod-owned-1");
        assert_eq!(owned[0].owner_id.as_deref(), Some(DEMO_SELLER_ID));
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
