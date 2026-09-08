import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { ADMIN_COOKIE_NAME, parseCookieHeader, type AdminControlService } from "@vimla/admin";
import type { FastifyRequest } from "fastify";
import { ADMIN_CONTROL } from "./admin.tokens.js";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";

@Injectable()
export class AdminOriginGuard implements CanActivate {
  constructor(@Inject(API_CONFIG) private readonly config: ApiRuntimeConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
      return true;
    }
    if (request.headers.origin !== this.config.adminOrigin) {
      throw new ForbiddenException("Untrusted admin origin");
    }
    return true;
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(ADMIN_CONTROL) private readonly admin: AdminControlService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = parseCookieHeader(request.headers.cookie, ADMIN_COOKIE_NAME);
    const actor = await this.admin.resolveSession(token);
    if (!actor) {
      throw new UnauthorizedException("Admin authentication required");
    }
    request.adminActor = actor;
    return true;
  }
}
