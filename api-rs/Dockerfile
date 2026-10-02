FROM ghcr.io/lukemathwalker/cargo-chef:latest-rust-1.99.0 AS chef
WORKDIR /app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --features otlp --recipe-path recipe.json
COPY . .
RUN cargo build --release --features otlp --bin api-rs

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home api
COPY --from=builder /app/target/release/api-rs /usr/local/bin/api-rs
USER 10001:10001
ENV PORT=3001
EXPOSE 3001
ENTRYPOINT ["/usr/local/bin/api-rs"]
