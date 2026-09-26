import { describe, expect, it, vi } from "vitest"
import { Test } from "@nestjs/testing"
import { ProductsController } from "./products.controller.js"
import { ProductsService } from "./products.service.js"

describe("ProductsController", () => {
  it("findAll delegates to ProductsService.findAll", async () => {
    const findAll = vi.fn().mockResolvedValue([{ id: "prod-1" }])

    const moduleRef = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [{ provide: ProductsService, useValue: { findAll, findOne: vi.fn() } }],
    }).compile()

    const controller = moduleRef.get(ProductsController)
    const result = await controller.findAll()

    expect(findAll).toHaveBeenCalledTimes(1)
    expect(result).toEqual([{ id: "prod-1" }])
  })

  it("findOne delegates to ProductsService.findOne with the given id", async () => {
    const findOne = vi.fn().mockResolvedValue({ id: "prod-1" })

    const moduleRef = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [{ provide: ProductsService, useValue: { findAll: vi.fn(), findOne } }],
    }).compile()

    const controller = moduleRef.get(ProductsController)
    const result = await controller.findOne("prod-1")

    expect(findOne).toHaveBeenCalledWith("prod-1")
    expect(result).toEqual({ id: "prod-1" })
  })
})
