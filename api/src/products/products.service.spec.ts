import { describe, expect, it, vi } from "vitest"
import { NotFoundException } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { ProductsService } from "./products.service.js"
import { PrismaService } from "../prisma/prisma.service.js"

async function createService(prisma: Record<string, unknown>) {
  const moduleRef = await Test.createTestingModule({
    providers: [ProductsService, { provide: PrismaService, useValue: prisma }],
  }).compile()

  return moduleRef.get(ProductsService)
}

describe("ProductsService", () => {
  it("findAll returns a page of products ordered oldest first", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "prod-1" }])
    const count = vi.fn().mockResolvedValue(1)
    const service = await createService({ product: { findMany, count } })

    const result = await service.findAll()

    expect(findMany).toHaveBeenCalledWith({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: 0,
      take: 20,
    })
    expect(result).toEqual({
      items: [{ id: "prod-1" }],
      page: 1,
      limit: 20,
      total: 1,
      hasNextPage: false,
    })
  })

  it("findAll paginates using the given page number", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "prod-21" }])
    const count = vi.fn().mockResolvedValue(30)
    const service = await createService({ product: { findMany, count } })

    const result = await service.findAll(2)

    expect(findMany).toHaveBeenCalledWith({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: 20,
      take: 20,
    })
    expect(result.hasNextPage).toBe(true)
  })

  it("findOne returns the product when it exists", async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: "prod-1", title: "Wireless Headphones" })
    const service = await createService({ product: { findUnique } })

    const result = await service.findOne("prod-1")

    expect(findUnique).toHaveBeenCalledWith({ where: { id: "prod-1" } })
    expect(result).toEqual({ id: "prod-1", title: "Wireless Headphones" })
  })

  it("findOne throws NotFoundException when the product doesn't exist", async () => {
    const findUnique = vi.fn().mockResolvedValue(null)
    const service = await createService({ product: { findUnique } })

    await expect(service.findOne("missing")).rejects.toThrow(NotFoundException)
  })
})
