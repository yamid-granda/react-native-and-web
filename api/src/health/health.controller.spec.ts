import { describe, expect, it, vi } from "vitest"
import { Test } from "@nestjs/testing"
import { HealthCheckService, PrismaHealthIndicator } from "@nestjs/terminus"
import { HealthController } from "./health.controller.js"
import { PrismaService } from "../prisma/prisma.service.js"

describe("HealthController", () => {
  it("delegates to HealthCheckService with a prisma ping check", async () => {
    const check = vi.fn().mockResolvedValue({ status: "ok", info: {}, error: {}, details: {} })

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: { check } },
        { provide: PrismaHealthIndicator, useValue: { pingCheck: vi.fn() } },
        { provide: PrismaService, useValue: {} },
      ],
    }).compile()

    const controller = moduleRef.get(HealthController)
    const result = await controller.check()

    expect(check).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ status: "ok", info: {}, error: {}, details: {} })
  })
})
