import { createParamDecorator, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { AuthenticatedUser } from "@vimla/auth";

export const AuthUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const user = request.vimlaUser;
    if (!user) {
      throw new UnauthorizedException("Authentication required");
    }
    return user;
  },
);
