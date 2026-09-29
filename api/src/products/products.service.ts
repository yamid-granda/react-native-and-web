import { Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "../prisma/prisma.service.js"

const PAGE_SIZE = 20

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(page = 1, q?: string) {
    const skip = (page - 1) * PAGE_SIZE
    const where = q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : undefined
    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        // id tiebreaker: bulk-seeded rows can share a createdAt timestamp,
        // which would otherwise make page boundaries non-deterministic.
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip,
        take: PAGE_SIZE,
      }),
      this.prisma.product.count({ where }),
    ])
    return { items, page, limit: PAGE_SIZE, total, hasNextPage: skip + items.length < total }
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } })
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`)
    }
    return product
  }
}
