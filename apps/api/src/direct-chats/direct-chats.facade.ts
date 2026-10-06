import { Inject, Injectable, Logger } from "@nestjs/common";
import type { AuthenticatedUser } from "@vimla/auth";
import type {
  CreateDirectConversation,
  DirectConversationView,
} from "@vimla/contracts";
import { DeviceService, DirectChatError, DirectChatService, type ActorContext } from "@vimla/direct-chats";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { PeopleService } from "../people/people.service.js";
import { PrismaService } from "../persistence/prisma.service.js";

@Injectable()
export class DirectChatsFacade {
  private readonly logger = new Logger(DirectChatsFacade.name);
  readonly chats: DirectChatService;
  readonly devices: DeviceService;

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(API_CONFIG) private readonly config: ApiRuntimeConfig,
    @Inject(PeopleService) private readonly people: PeopleService,
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

  actor(user: Pick<AuthenticatedUser, "id">): ActorContext {
    return { userId: user.id };
  }

  async create(
    user: Pick<AuthenticatedUser, "id">,
    input: CreateDirectConversation,
  ): Promise<DirectConversationView> {
    const peer = await this.people.resolveDirectChatPeer(
      user.id,
      input.peerHandle,
    );
    if (!peer) {
      throw new DirectChatError("NOT_FOUND", "User was not found");
    }
    return this.chats.create(this.actor(user), peer.userId);
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
