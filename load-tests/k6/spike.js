import { Rate } from "k6/metrics"
import http from "k6/http"
import { BASE_URL, getProductPage, randomPage } from "./helpers.js"

const serverErrors = new Rate("server_errors")
const connectionErrors = new Rate("connection_errors")

export const options = {
  scenarios: {
    spike: {
      executor: "ramping-arrival-rate",
      startRate: 100,
      timeUnit: "1s",
      preAllocatedVUs: 1000,
      maxVUs: 8000,
      stages: [
        { target: 5000, duration: "10s" },
        { target: 5000, duration: "2m" },
        { target: 100, duration: "10s" },
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(99)<200"],
    server_errors: ["rate<0.001"],
    connection_errors: ["rate==0"],
    http_req_failed: ["rate<0.001"],
  },
}

export default function () {
  const pageResponse = getProductPage(randomPage())
  serverErrors.add(pageResponse.status >= 500)
  connectionErrors.add(pageResponse.status === 0)
  if (pageResponse.status === 0) {
    const healthResponse = http.get(`${BASE_URL}/health`, { tags: { name: "GET /health" } })
    serverErrors.add(healthResponse.status >= 500)
    connectionErrors.add(healthResponse.status === 0)
  }
}
