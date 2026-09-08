import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import {
  ALLOW_UNVERIFIED_KEY,
  SENSITIVE_AREA_KEY,
  SENSITIVE_MUTATION_KEY,
} from "./sensitive-area.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

@Injectable()
export class SensitiveAreaGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    const controller = context.getClass();
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_UNVERIFIED_KEY, [handler, controller])) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const mutating = MUTATING_METHODS.has(request.method);
    const sensitiveMutation = this.reflector.getAllAndOverride<boolean>(SENSITIVE_MUTATION_KEY, [
      handler,
      controller,
    ]);
    const sensitiveArea = this.reflector.getAllAndOverride<boolean>(SENSITIVE_AREA_KEY, [
      handler,
      controller,
    ]);

    if (!sensitiveMutation && !(sensitiveArea && mutating)) {
      return true;
    }

    const user = request.vimlaUser;
    if (!user?.emailVerified) {
      throw new ForbiddenException({
        code: "email_not_verified",
        message: "Email is not verified",
      });
    }

    return true;
  }
}
