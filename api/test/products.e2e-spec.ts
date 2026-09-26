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

  it("GET /products returns the seeded products", async () => {
    const response = await request(app.getHttpServer()).get("/products")

    expect(response.status).toBe(200)
    expect(Array.isArray(response.body)).toBe(true)
    expect(response.body.length).toBeGreaterThan(0)
  })

  it("GET /products/:id returns the matching product", async () => {
    const list = await request(app.getHttpServer()).get("/products")
    const [first] = list.body

    const response = await request(app.getHttpServer()).get(`/products/${first.id}`)

    expect(response.status).toBe(200)
    expect(response.body.id).toBe(first.id)
  })

  it("GET /products/:id returns 404 for an unknown id", async () => {
    const response = await request(app.getHttpServer()).get("/products/does-not-exist")

    expect(response.status).toBe(404)
  })
})
