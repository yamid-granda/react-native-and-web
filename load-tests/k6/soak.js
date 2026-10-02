import http from "k6/http"
import { Rate, Trend } from "k6/metrics"
import { sleep } from "k6"
import { BASE_URL, getProductPage, randomPage } from "./helpers.js"

const memoryBytes = new Trend("process_rss_bytes", true)
const memoryGrowthPercent = new Trend("process_rss_growth_percent", true)
const monitorFailures = new Rate("metrics_scrape_failures")
const runStartedAt = Date.now()
let initialRss

export const options = {
  scenarios: {
    load: {
      executor: "constant-arrival-rate",
      rate: 500,
      timeUnit: "1s",
      duration: "1h",
      preAllocatedVUs: 400,
      maxVUs: 1500,
    },
    memory: {
      executor: "constant-vus",
      vus: 1,
      duration: "1h",
      exec: "sampleMemory",
    },
  },
  thresholds: {
    "http_req_duration{period:early}": ["p(95)<50"],
    "http_req_duration{period:late}": ["p(95)<50"],
    http_req_failed: ["rate<0.001"],
    process_rss_growth_percent: ["max<10"],
    metrics_scrape_failures: ["rate==0"],
  },
}

export default function load() {
  const period = Date.now() - runStartedAt < 30 * 60 * 1000 ? "early" : "late"
  getProductPage(randomPage(), { period })
}

export function sampleMemory() {
  const response = http.get(`${BASE_URL}/metrics`, { tags: { name: "GET /metrics" } })
  if (response.status !== 200) {
    monitorFailures.add(true)
    sleep(10)
    return
  }
  monitorFailures.add(false)
  const match = response.body.match(/^process_resident_memory_bytes\s+([\d.eE+-]+)/m)
  if (!match) {
    monitorFailures.add(true)
    sleep(10)
    return
  }
  const current = Number(match[1])
  initialRss ??= current
  memoryBytes.add(current)
  memoryGrowthPercent.add(Math.max(0, ((current - initialRss) / initialRss) * 100))
  sleep(10)
}
