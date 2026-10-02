import http from "k6/http"
import { check } from "k6"

// api-rs's side-by-side dev port. When api-rs runs on the contract port
// instead (NestJS stopped), pass BASE_URL=http://localhost:3001.
export const BASE_URL = (__ENV.BASE_URL || "http://localhost:3003").replace(/\/$/, "")
export const PAGE_COUNT = Number(__ENV.PAGE_COUNT || 2500)

// A load generator is a single host, so without this every request would share
// one client IP and the default RATE_LIMIT_PER_IP_RPS=100 would 429 most of
// the run. CLIENT_IPS spreads requests over that many synthetic
// `CF-Connecting-IP` values — what a real client population looks like. Set
// CLIENT_IPS=1 (or RATE_LIMIT_PER_IP_RPS=0) to keep the per-IP limiter in the
// measurement instead.
export const CLIENT_IPS = Number(__ENV.CLIENT_IPS || 500)

function clientHeaders() {
  if (CLIENT_IPS <= 1) return {}
  const octet = () => 1 + Math.floor(Math.random() * 254)
  return { "CF-Connecting-IP": `10.${octet()}.${octet()}.${octet()}` }
}

export function getProductPage(page, tags = {}) {
  const response = http.get(`${BASE_URL}/products?page=${page}`, {
    headers: clientHeaders(),
    tags: { name: "GET /products", ...tags },
  })
  check(response, {
    "status is 200": (result) => result.status === 200,
    "page envelope is valid": (result) => {
      if (result.status !== 200) return false
      try {
        const body = result.json()
        return Array.isArray(body.items) && body.page === page && body.limit === 20
      } catch {
        return false
      }
    },
  })
  return response
}

export function randomPage() {
  return 1 + Math.floor(Math.random() * PAGE_COUNT)
}
