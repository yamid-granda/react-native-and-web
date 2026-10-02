import { getProductPage, randomPage } from "./helpers.js"

export const options = {
  scenarios: {
    steady: {
      executor: "constant-arrival-rate",
      rate: 1000,
      timeUnit: "1s",
      duration: "10m",
      preAllocatedVUs: 500,
      maxVUs: 2000,
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<50"],
    http_req_failed: ["rate<0.001"],
    checks: ["rate>0.999"],
  },
}

export default function () {
  getProductPage(randomPage())
}
