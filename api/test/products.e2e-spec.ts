import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Test } from "@nestjs/testing"
import type { INestApplication } from "@nestjs/common"
import request from "supertest"
import { AppModule } from "../src/app.module.js"

describe("Products (e2e)", () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it("GET /products returns a page of at most 20 seeded products", async () => {
    const response = await request(app.getHttpServer()).get("/products")

    expect(response.status).toBe(200)
    expect(Array.isArray(response.body.items)).toBe(true)
    expect(response.body.items.length).toBeGreaterThan(0)
    expect(response.body.items.length).toBeLessThanOrEqual(20)
    expect(response.body.page).toBe(1)
    expect(response.body.limit).toBe(20)
    expect(response.body.hasNextPage).toBe(true)
  })

  it("GET /products?page=2 returns a different, non-overlapping page", async () => {
    const page1 = await request(app.getHttpServer()).get("/products")
    const page2 = await request(app.getHttpServer()).get("/products?page=2")

    const page1Ids = new Set(page1.body.items.map((product: { id: string }) => product.id))
    const overlap = page2.body.items.filter((product: { id: string }) => page1Ids.has(product.id))

    expect(page2.body.page).toBe(2)
    expect(overlap).toHaveLength(0)
  })

  it("GET /products/:id returns the matching product", async () => {
    const list = await request(app.getHttpServer()).get("/products")
    const [first] = list.body.items

    const response = await request(app.getHttpServer()).get(`/products/${first.id}`)

    expect(response.status).toBe(200)
    expect(response.body.id).toBe(first.id)
  })

  it("GET /products/:id returns 404 for an unknown id", async () => {
    const response = await request(app.getHttpServer()).get("/products/does-not-exist")

    expect(response.status).toBe(404)
  })
})
