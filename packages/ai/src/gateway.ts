import type { AiProvider, ProviderChatRequest, ProviderChatResult } from "./types.js";

export class VimlaAiGateway {
  constructor(private readonly provider: AiProvider) {}

  get activeProvider(): AiProvider {
    return this.provider;
  }

  streamChat(request: ProviderChatRequest): Promise<ProviderChatResult> {
    return this.provider.streamChat(request);
  }
}
