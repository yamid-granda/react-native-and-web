import { Module } from "@nestjs/common"
import { PrismaModule } from "./prisma/prisma.module.js"
import { HealthModule } from "./health/health.module.js"

@Module({
  imports: [PrismaModule, HealthModule],
})
export class AppModule {}
