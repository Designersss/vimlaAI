import type { Prisma, PrismaClient } from "@vimla/database";

export type DbClient = PrismaClient | Prisma.TransactionClient;

export interface ActorContext {
  userId: string;
}

export interface TrustedSourceContext {
  conversationId?: string;
  messageId?: string;
}

export interface ListQuery {
  limit: number;
  cursor?: string;
  archived?: boolean;
}
