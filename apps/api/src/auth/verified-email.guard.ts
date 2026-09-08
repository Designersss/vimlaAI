import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
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
