import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(API_CONFIG) private readonly config: ApiRuntimeConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
      return true;
    }

    const origin = request.headers.origin;
    if (origin !== this.config.webOrigin) {
      throw new ForbiddenException("Untrusted origin");
    }

    return true;
  }
}
