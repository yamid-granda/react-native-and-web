import "dotenv/config"
import "reflect-metadata"
import { NestFactory } from "@nestjs/core"
import { AppModule } from "./app.module.js"

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  // Only web-application needs this — browsers enforce CORS, Expo's native
  // fetch calls don't.
  app.enableCors({ origin: "http://localhost:3000" })
  await app.listen(process.env.PORT ?? 3001)
}

bootstrap()
