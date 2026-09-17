import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { toAuthenticatedUser, type VimlaAuth } from "@vimla/auth";
import { ALLOW_HANDLE_ONBOARDING } from "./allow-handle-onboarding.decorator.js";
import { HandleService } from "./handle.service.js";
import { VIMLA_AUTH } from "./auth.tokens.js";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(VIMLA_AUTH) private readonly auth: VimlaAuth,
    private readonly reflector: Reflector,
    private readonly handles: HandleService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const session = await this.auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });

    if (!session) {
      throw new UnauthorizedException("Authentication required");
    }

    request.vimlaUser = toAuthenticatedUser(session.user);

    const allowOnboarding = this.reflector.getAllAndOverride<boolean>(ALLOW_HANDLE_ONBOARDING, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowOnboarding) {
      return true;
    }

    await this.handles.activateVerified(session.user.id);
    const handle = await this.handles.readForUser(session.user.id);
    if (!handle || handle.status !== "ACTIVE") {
      throw new ForbiddenException({
        code: "handle_required",
        message: "Choose a public handle to continue",
      });
    }

    return true;
  }
}
