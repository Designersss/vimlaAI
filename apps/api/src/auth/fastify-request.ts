import type { AuthenticatedUser } from "@vimla/auth";
import type { AdminActor } from "@vimla/admin";

declare module "fastify" {
  interface FastifyRequest {
    vimlaUser?: AuthenticatedUser;
    adminActor?: AdminActor;
  }
}
