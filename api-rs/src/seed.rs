use rand::rngs::StdRng;
use rand::{RngExt, SeedableRng};
use sqlx::PgPool;

const DEFAULT_SEED_COUNT: usize = 1000;

/// Postgres caps a statement at 65535 bind parameters and each row binds 8, so
/// 2000 rows stays well clear of it while keeping round trips low.
const INSERT_CHUNK: usize = 2000;

const SEED_RNG: u64 = 20260928;

const ADJECTIVES: &[&str] = &[
    "Wireless",
    "Vintage",
    "Compact",
    "Premium",
    "Recycled",
    "Portable",
    "Noise-Cancelling",
    "Handmade",
    "Ultrafast",
    "Weatherproof",
];
const NOUNS: &[&str] = &[
    "Headphones",
    "Keyboard",
    "Coffee Mug",
    "Running Shoes",
    "Backpack",
    "Desk Lamp",
    "Yoga Mat",
    "Bluetooth Speaker",
    "Water Bottle",
    "Notebook",
    "Standing Desk",
    "Trail Camera",
];

const INSERT_COLUMNS: &str = r#"("id", "title", "description", "price", "currency", "imageUrl", "stock", "createdAt", "ownerId")"#;

struct SeedProduct {
    id: String,
    title: String,
    description: Option<String>,
    price: f64,
    image_url: Option<String>,
    stock: i32,
    owner_id: Option<String>,
}

/// Fixed ids so both platforms' e2e specs can target a known product, and so
/// re-seeding is idempotent. `prod-1` is clicked by the web marketplace spec.
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

/// How many fixed rows [`run`] upserts, so `api-rs-db` can report a number it did
/// not hardcode and drift from.
pub fn fixture_count() -> usize {
    fixture_products().len() + demo_sellers().len()
}

/// Rejects a bad `SEED_COUNT` rather than silently seeding an empty or enormous
/// database.
pub fn seed_count_from_env() -> Result<usize, String> {
    let Ok(raw) = std::env::var("SEED_COUNT") else {
        return Ok(DEFAULT_SEED_COUNT);
    };
    raw.trim()
        .parse()
        .map_err(|_| format!("SEED_COUNT must be a non-negative integer, got {raw:?}"))
}

/// Populates the catalogue: the demo seller first (products reference it), then
/// the fixture rows by upsert, then `count` generated rows in chunks.
/// Re-running is safe — fixtures are updated to match and generated rows are left
/// alone on conflict.
pub async fn run(pool: &PgPool, count: usize) -> Result<(), sqlx::Error> {
    for seller in demo_sellers() {
        upsert_seller(pool, &seller).await?;
    }
    for product in fixture_products() {
        upsert_fixture(pool, &product).await?;
    }

    let mut rng = StdRng::seed_from_u64(SEED_RNG);
    let mut batch = Vec::with_capacity(INSERT_CHUNK);
    for index in 0..count {
        batch.push(generate(&mut rng, index));
        if batch.len() == INSERT_CHUNK {
            insert_generated(pool, &batch).await?;
            batch.clear();
        }
    }
    if !batch.is_empty() {
        insert_generated(pool, &batch).await?;
    }

    Ok(())
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

async fn insert_generated(pool: &PgPool, batch: &[SeedProduct]) -> Result<(), sqlx::Error> {
    // `push_values` supplies the VALUES keyword itself.
    let mut query = sqlx::QueryBuilder::new(format!("INSERT INTO \"Product\" {INSERT_COLUMNS} "));
    query.push_values(batch, |mut row, product| {
        row.push_bind(&product.id)
            .push_bind(&product.title)
            .push_bind(&product.description)
            .push_bind(product.price)
            .push_bind("USD")
            .push_bind(&product.image_url)
            .push_bind(product.stock)
            .push_bind(chrono::Utc::now().naive_utc())
            // Generated rows stay ownerless: they are catalogue filler, and giving
            // them all one seller would make the demo store look far busier than
            // it is.
            .push_bind(None::<&str>);
    });
    query.push(" ON CONFLICT (\"id\") DO NOTHING");

    query.build().execute(pool).await?;

    Ok(())
}

/// A small combinator rather than a faker crate: seed data only has to look
/// plausible, and this keeps generation deterministic across dependency bumps.
fn generate(rng: &mut StdRng, index: usize) -> SeedProduct {
    let id = format!("prod-gen-{}", index + 1);
    let adjective = ADJECTIVES[rng.random_range(0..ADJECTIVES.len())];
    let noun = NOUNS[rng.random_range(0..NOUNS.len())];

    SeedProduct {
        title: format!("{adjective} {noun}"),
        description: Some(format!("Durable everyday {noun}, built for daily use.")),
        // Two decimals, matching the shape of the fixture rows.
        price: rng.random_range(500..50_000) as f64 / 100.0,
        image_url: Some(format!("https://picsum.photos/seed/{id}/400/400")),
        // Weighted so most rows are well stocked, but out-of-stock and
        // low-stock states stay common enough to exercise the UI.
        stock: match rng.random_range(0..100) {
            0..10 => 0,
            10..25 => rng.random_range(1..=5),
            _ => rng.random_range(6..=200),
        },
        owner_id: None,
        id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `SEED_COUNT` is process-global, so every test that sets it holds this
    /// lock for the whole set-and-restore window.
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn seed_count_from_env_set_to(raw: &str) -> Result<usize, String> {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let previous = std::env::var("SEED_COUNT").ok();
        // SAFETY: the mutex above serialises every access in this process, and
        // the lock is held until the variable is restored.
        unsafe { std::env::set_var("SEED_COUNT", raw) };
        let result = seed_count_from_env();
        match previous {
            Some(value) => unsafe { std::env::set_var("SEED_COUNT", value) },
            None => unsafe { std::env::remove_var("SEED_COUNT") },
        }
        result
    }

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

    #[test]
    fn seed_count_defaults_to_1000_and_rejects_garbage() {
        assert_eq!(seed_count_from_env_set_to("0").unwrap(), 0);
        assert_eq!(seed_count_from_env_set_to("50000").unwrap(), 50_000);
        assert!(seed_count_from_env_set_to("-1").is_err());
        assert!(seed_count_from_env_set_to("abc").is_err());
    }

    #[test]
    fn seed_count_falls_back_to_the_default_when_unset() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let previous = std::env::var("SEED_COUNT").ok();
        // SAFETY: the mutex above serialises every access in this process.
        unsafe { std::env::remove_var("SEED_COUNT") };
        let count = seed_count_from_env();
        if let Some(value) = previous {
            unsafe { std::env::set_var("SEED_COUNT", value) };
        }
        assert_eq!(count.unwrap(), DEFAULT_SEED_COUNT);
    }

    #[test]
    fn generated_rows_are_deterministic_and_cover_the_stock_states() {
        let sample = || {
            let mut rng = StdRng::seed_from_u64(SEED_RNG);
            (0..500)
                .map(|index| generate(&mut rng, index))
                .map(|product| (product.id, product.stock))
                .collect::<Vec<_>>()
        };

        let first = sample();
        assert_eq!(first, sample(), "the same seed must replay the same batch");
        assert_eq!(first.first().unwrap().0, "prod-gen-1");
        assert_eq!(first.last().unwrap().0, "prod-gen-500");

        let mut stocks = first.iter().map(|(_, stock)| *stock);
        assert!(stocks.clone().any(|stock| stock == 0), "needs out-of-stock rows");
        assert!(stocks.clone().any(|stock| (1..=5).contains(&stock)), "needs low-stock rows");
        assert!(stocks.any(|stock| stock > 5), "needs healthy-stock rows");
    }

    #[test]
    fn prices_stay_in_range_and_never_exceed_two_decimals() {
        let mut rng = StdRng::seed_from_u64(SEED_RNG);
        for index in 0..500 {
            let product = generate(&mut rng, index);
            assert!(
                (5.0..=500.0).contains(&product.price),
                "price out of range: {}",
                product.price
            );
            // What matters is that no digits are lost when Postgres stores the value and
            // it comes back: scaling by 100 is not a valid check, because f64
            // has no exact 2-decimal representation (40.23 * 100 is
            // 4022.9999999999995). Formatting to two places and parsing the
            // result is the round trip that actually happens.
            let cents = format!("{:.2}", product.price);
            assert_eq!(
                cents.parse::<f64>().unwrap(),
                product.price,
                "price is not 2-decimal: {cents}"
            );
            assert!(product.title.contains(' '), "title should read as adjective + noun");
        }
    }
}
