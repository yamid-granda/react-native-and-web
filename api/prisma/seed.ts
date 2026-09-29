import "dotenv/config"
import { faker } from "@faker-js/faker"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../src/generated/prisma/client.js"

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

// Fixed ids (not cuid()-generated) so e2e specs on both platforms can target
// a known product deterministically, and so this script is idempotent.
const products = [
  {
    id: "prod-1",
    title: "Wireless Headphones",
    description: "Noise-cancelling over-ear headphones with 30h battery life.",
    price: 129.99,
    imageUrl: "https://picsum.photos/seed/prod-1/400/400",
    stock: 42,
  },
  {
    id: "prod-2",
    title: "Mechanical Keyboard",
    description: "Hot-swappable 75% keyboard with brown switches.",
    price: 89.5,
    imageUrl: "https://picsum.photos/seed/prod-2/400/400",
    stock: 0,
  },
  {
    id: "prod-3",
    title: "Ceramic Coffee Mug",
    description: "350ml matte-finish mug, dishwasher safe.",
    price: 18,
    imageUrl: "https://picsum.photos/seed/prod-3/400/400",
    stock: 120,
  },
  {
    id: "prod-4",
    title: "Running Shoes",
    description: "Lightweight trainers with breathable mesh upper.",
    price: 74.99,
    imageUrl: "https://picsum.photos/seed/prod-4/400/400",
    stock: 2,
  },
  {
    id: "prod-5",
    title: "Backpack",
    description: "Water-resistant 20L daypack with laptop sleeve.",
    price: 54,
    stock: 15,
  },
  {
    id: "prod-6",
    title: "Desk Lamp",
    description: "Dimmable LED lamp with USB-C charging port.",
    price: 32.25,
    imageUrl: "https://picsum.photos/seed/prod-6/400/400",
    stock: 0,
  },
  { id: "prod-7", title: "Yoga Mat", price: 24.99, stock: 3 },
  {
    id: "prod-8",
    title: "Bluetooth Speaker",
    description: "Compact IPX7 speaker, 12h playback.",
    price: 45,
    imageUrl: "https://picsum.photos/seed/prod-8/400/400",
    stock: 60,
  },
]

// Fixed seed so this batch is the same across reruns, matching the file's
// existing idempotency intent for the hand-picked products above.
faker.seed(20260928)

const generatedProducts = Array.from({ length: 1000 }, (_, i) => {
  const id = `prod-gen-${i + 1}`
  return {
    id,
    title: faker.commerce.productName(),
    description: faker.commerce.productDescription(),
    price: Number(faker.commerce.price({ min: 5, max: 500, dec: 2 })),
    imageUrl: `https://picsum.photos/seed/${id}/400/400`,
    // weighted so most rows are healthily stocked but out-of-stock/low-stock
    // states are still common enough to hit while browsing the seeded list
    stock: faker.helpers.weightedArrayElement([
      { weight: 10, value: 0 },
      { weight: 15, value: faker.number.int({ min: 1, max: 5 }) },
      { weight: 75, value: faker.number.int({ min: 6, max: 200 }) },
    ]),
  }
})

async function main() {
  for (const product of products) {
    await prisma.product.upsert({ where: { id: product.id }, update: product, create: product })
  }

  // One bulk insert instead of 1000 round trips; skipDuplicates keeps
  // reruns safe without needing per-row upsert reconciliation, which
  // doesn't matter for randomly generated filler data.
  await prisma.product.createMany({ data: generatedProducts, skipDuplicates: true })
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
