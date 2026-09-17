import { Module } from "@nestjs/common";
import {
  createNativeHttpTransport,
  MockAiProvider,
  ProxyApiProvider,
  VimlaAiGateway,
  type AiProvider,
} from "@vimla/ai";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { AuthModule } from "../auth/auth.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { AI_GATEWAY, AI_PROVIDER } from "./ai.tokens.js";
import { AiConcurrencyService } from "./concurrency.service.js";
import { AiRateLimitGuard } from "./ai-rate-limit.guard.js";
import { ChatMentionRoutingService } from "./chat-mention-routing.service.js";
import { ConversationsController } from "./conversations.controller.js";
import { ModelsController } from "./models.controller.js";
import { TextChatService } from "./text-chat.service.js";

@Module({
  imports: [PersistenceModule, AuthModule, BillingModule],
  controllers: [ModelsController, ConversationsController],
  providers: [
    AiRateLimitGuard,
    AiConcurrencyService,
    ChatMentionRoutingService,
    {
      provide: AI_PROVIDER,
      inject: [API_CONFIG],
      useFactory: (config: ApiRuntimeConfig): AiProvider => {
        if (config.aiTextProvider === "mock") {
          return new MockAiProvider();
        }

        if (!config.proxyapiApiKey) {
          throw new Error("PROXYAPI_API_KEY is required for the ProxyAPI provider");
        }

        return new ProxyApiProvider(
          config.proxyapiApiKey,
          config.proxyapiBaseUrl,
          config.aiProviderTimeoutMs,
          createNativeHttpTransport(),
        );
      },
    },
    {
      provide: AI_GATEWAY,
      inject: [AI_PROVIDER],
      useFactory: (provider: AiProvider) => new VimlaAiGateway(provider),
    },
    TextChatService,
  ],
  exports: [AI_PROVIDER, TextChatService],
})
export class AiModule {}
