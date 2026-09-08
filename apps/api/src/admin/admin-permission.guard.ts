import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hasPermission, isAdminPermission, type AdminControlService } from "@vimla/admin";
import type { FastifyRequest } from "fastify";
import { ADMIN_PERMISSION_KEY, ADMIN_STEP_UP_KEY } from "./admin-permission.decorator.js";
import { ADMIN_CONTROL } from "./admin.tokens.js";

@Injectable()
export class AdminPermissionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ADMIN_CONTROL) private readonly admin: AdminControlService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<string | undefined>(ADMIN_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permission) {
      throw new ForbiddenException("Admin permission is not declared");
    }
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const actor = request.adminActor;
    if (!isAdminPermission(permission) || !actor || !hasPermission(actor.permissions, permission)) {
      throw new ForbiddenException("Missing admin permission");
    }
    const stepUp = this.reflector.getAllAndOverride<boolean>(ADMIN_STEP_UP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (stepUp && !this.admin.hasFreshStepUp(actor)) {
      throw new ForbiddenException("Recent step-up authentication is required");
    }
    return true;
  }
}
