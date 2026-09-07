import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { toAuthenticatedUser, type VimlaAuth } from "@vimla/auth";
import { VIMLA_AUTH } from "./auth.tokens.js";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(VIMLA_AUTH) private readonly auth: VimlaAuth) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const session = await this.auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });

    if (!session) {
      throw new UnauthorizedException("Authentication required");
    }

    request.vimlaUser = toAuthenticatedUser(session.user);
    return true;
  }
}
