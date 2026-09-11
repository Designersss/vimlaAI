import { Inject, Injectable, Logger } from "@nestjs/common";
import { DeviceService, DirectChatError, DirectChatService, type ActorContext } from "@vimla/direct-chats";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { PrismaService } from "../persistence/prisma.service.js";

@Injectable()
export class DirectChatsFacade {
  private readonly logger = new Logger(DirectChatsFacade.name);
  readonly chats: DirectChatService;
  readonly devices: DeviceService;

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(API_CONFIG) private readonly config: ApiRuntimeConfig,
  ) {
    this.chats = new DirectChatService(prisma.client, {
      maxCiphertextBytes: config.directChatsMaxCiphertextBytes,
    });
    this.devices = new DeviceService(prisma.client);
  }

  assertEnabled(): void {
    if (!this.config.directChatsEnabled) {
      throw new DirectChatError("DISABLED", "Direct Chats are disabled");
    }
  }

  actor(user: { id: string; email: string }): ActorContext {
    return { userId: user.id, email: user.email };
  }

  logMutation(operation: string, userId: string, conversationId?: string): void {
    this.logger.log({
      msg: "direct_chats.mutate",
      operation,
      actorUserId: userId,
      conversationId,
    });
  }
}
