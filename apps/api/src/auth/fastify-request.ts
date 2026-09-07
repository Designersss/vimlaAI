import type { AuthenticatedUser } from "@vimla/auth";

declare module "fastify" {
  interface FastifyRequest {
    vimlaUser?: AuthenticatedUser;
  }
}
