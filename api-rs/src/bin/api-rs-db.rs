use api_rs::config::Config;
use api_rs::{migrations, seed};
use sqlx::postgres::PgPoolOptions;

/// Schema and seed management, kept out of the served binary: `api-rs` only
/// reads, so nothing it needs at runtime should depend on write access.
///
///     cargo run --bin api-rs-db -- migrate
///     cargo run --bin api-rs-db -- seed
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
            let count = seed::seed_count_from_env()?;
            migrations::run(&pool).await?;
            seed::run(&pool, count).await?;
            println!("seeded 8 fixture products and {count} generated products");
        }
        other => return Err(format!("unknown command {other:?}\n\n{}", usage()).into()),
    }

    pool.close().await;
    Ok(())
}

fn usage() -> String {
    "usage: api-rs-db <migrate|seed>\n  migrate  apply pending migrations\n  seed     migrate, then seed SEED_COUNT products (default 1000)".to_string()
}
