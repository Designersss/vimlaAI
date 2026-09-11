import type { PrismaClient } from "@vimla/database";

export type DbClient = PrismaClient;

export interface ActorContext {
  userId: string;
  email: string;
}

export interface DirectChatServiceOptions {
  maxCiphertextBytes: number;
  maxEnvelopes: number;
}
