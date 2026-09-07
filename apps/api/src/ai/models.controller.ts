import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { aiModelsResponseSchema, type AiModelsResponse } from "@vimla/contracts";
import { AuthGuard } from "../auth/auth.guard.js";
import { TextChatService } from "./text-chat.service.js";

@Controller("v1/ai")
@UseGuards(AuthGuard)
export class ModelsController {
  constructor(@Inject(TextChatService) private readonly chat: TextChatService) {}

  @Get("models")
  async listModels(): Promise<AiModelsResponse> {
    const models = await this.chat.listRetailModels();
    return aiModelsResponseSchema.parse({ models });
  }
}
