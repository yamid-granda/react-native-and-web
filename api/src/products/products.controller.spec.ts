import { describe, expect, it, vi } from "vitest"
import { Test } from "@nestjs/testing"
import { ProductsController } from "./products.controller.js"
import { ProductsService } from "./products.service.js"

describe("ProductsController", () => {
  it("findAll delegates to ProductsService.findAll with the given page", async () => {
    const page = { items: [{ id: "prod-1", stock: 5 }], page: 1, limit: 20, total: 1, hasNextPage: false }
    const findAll = vi.fn().mockResolvedValue(page)

    const moduleRef = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [{ provide: ProductsService, useValue: { findAll, findOne: vi.fn() } }],
    }).compile()

    const controller = moduleRef.get(ProductsController)
    const result = await controller.findAll("2")

    expect(findAll).toHaveBeenCalledWith(2, undefined)
    expect(result).toEqual(page)
  })

  it("findAll defaults to page 1 when no page is given", async () => {
    const findAll = vi.fn().mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, hasNextPage: false })

    const moduleRef = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [{ provide: ProductsService, useValue: { findAll, findOne: vi.fn() } }],
    }).compile()

    const controller = moduleRef.get(ProductsController)
    await controller.findAll()

    expect(findAll).toHaveBeenCalledWith(1, undefined)
  })

  it("findAll forwards the q query param to ProductsService.findAll", async () => {
    const findAll = vi.fn().mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, hasNextPage: false })

    const moduleRef = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [{ provide: ProductsService, useValue: { findAll, findOne: vi.fn() } }],
    }).compile()

    const controller = moduleRef.get(ProductsController)
    await controller.findAll("1", "headphones")

    expect(findAll).toHaveBeenCalledWith(1, "headphones")
  })

  it("findOne delegates to ProductsService.findOne with the given id", async () => {
    const findOne = vi.fn().mockResolvedValue({ id: "prod-1", stock: 5 })

    const moduleRef = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [{ provide: ProductsService, useValue: { findAll: vi.fn(), findOne } }],
    }).compile()

    const controller = moduleRef.get(ProductsController)
    const result = await controller.findOne("prod-1")

    expect(findOne).toHaveBeenCalledWith("prod-1")
    expect(result).toEqual({ id: "prod-1", stock: 5 })
  })
})
