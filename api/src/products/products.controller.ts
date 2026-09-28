import { Controller, Get, Param, Query } from "@nestjs/common"
import { ProductsService } from "./products.service.js"

@Controller("products")
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  findAll(@Query("page") page?: string) {
    return this.productsService.findAll(Number(page) || 1)
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.productsService.findOne(id)
  }
}
