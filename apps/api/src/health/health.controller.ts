import { Controller, Get, HttpCode, Inject, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { HealthResponse } from "@vimla/contracts";
import { HealthService } from "./health.service.js";
import { requestIdResponseHeaders } from "../observability/logger.js";

@Controller("health")
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get()
  @HttpCode(200)
  async getHealth(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<HealthResponse> {
    const body = await this.health.check();
    const headers = requestIdResponseHeaders(String(request.id));
    for (const [name, value] of Object.entries(headers)) {
      reply.header(name, value);
    }

    if (body.status !== "ok") {
      reply.code(503);
    }

    return body;
  }
}
