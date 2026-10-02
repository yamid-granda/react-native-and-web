# Cloudflare edge configuration

The API sets cache headers but does not configure a Cloudflare zone. For a
production hostname:

1. Proxy the API DNS record through Cloudflare and enable the free managed
   WAF ruleset.
2. Add a Cache Rule matching `GET` requests whose URI path starts with
   `/products`.
3. Set cache eligibility to eligible and use the origin cache-control header
   (`s-maxage=30, stale-while-revalidate=60`) for edge TTL. Keep browser TTL
   at zero; the API sends `max-age=0`.
4. Add a bypass rule for every non-GET method and every path other than
   `/products` and `/products/*`. Do not cache `/health` or `/metrics`.
5. If placing the API behind Cloudflare's load balancer, configure health
   monitoring against `GET /health` and preserve `CF-Connecting-IP` to the
   origin for per-client rate limits.

Cloudflare's default cache behavior does not cache arbitrary API JSON solely
because it is a GET. The explicit Cache Rule is required; verify a second
request returns `CF-Cache-Status: HIT` before treating edge caching as active.
