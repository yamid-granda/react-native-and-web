use api_rs::config::Config;
use api_rs::{migrations, seed};
use sqlx::postgres::PgPoolOptions;

/// Schema and seed management, kept out of the served binary: `api-rs` only
/// reads, so nothing it needs at runtime should depend on write access.
///
///     cargo run --bin api-rs-db -- migrate
///     cargo run --bin api-rs-db -- seed
///     cargo run --bin api-rs-db -- seed-fixtures
///     cargo run --bin api-rs-db -- clear-fixtures
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _ = dotenvy::dotenv();
    let mut args = std::env::args().skip(1);
    let Some(command) = args.next() else {
        eprintln!("{}", usage());
        std::process::exit(2);
    };

    if let Some(unexpected) = args.next() {
        return Err(format!("unexpected argument {unexpected:?}\n\n{}", usage()).into());
    }

    let config = Config::from_env()?;
    // One connection is enough: migrations and seeding are both single-writer
    // and sequential.
    let pool = PgPoolOptions::new().max_connections(1).connect(&config.database_url).await?;

    match command.as_str() {
        "migrate" => {
            migrations::run(&pool).await?;
            println!("schema up to date ({} migrations)", migrations::MIGRATOR.iter().count());
        }
        "seed" => {
            migrations::run(&pool).await?;
            seed::run(&pool).await?;
            println!(
                "seeded {} demo seller and no products; the marketplace fills up as sellers create them",
                seed::seller_count(),
            );
        }
        "seed-fixtures" => {
            migrations::run(&pool).await?;
            seed::seed_fixtures(&pool).await?;
            println!(
                "seeded {} fixture rows (one seller, one owned product); run \
                 clear-fixtures when the test run is done",
                seed::fixture_count(),
            );
        }
        "clear-fixtures" => {
            let removed = seed::clear_fixtures(&pool).await?;
            println!(
                "removed {removed} fixture products; sellers and created products are untouched"
            );
        }
        other => return Err(format!("unknown command {other:?}\n\n{}", usage()).into()),
    }

    pool.close().await;
    Ok(())
}

fn usage() -> String {
    concat!(
        "usage: api-rs-db <migrate|seed|seed-fixtures|clear-fixtures>\n",
        "  migrate          apply pending migrations\n",
        "  seed             migrate, then upsert the demo seller — no products\n",
        "  seed-fixtures    migrate, then upsert the demo seller and the e2e fixture products\n",
        "  clear-fixtures   delete the e2e fixture products again",
    )
    .to_string()
}
