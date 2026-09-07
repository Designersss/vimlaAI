import { makeAutoObservable } from "mobx";
import type {
  ChatMessage,
  ConversationSummary,
  RetailAiModel,
  UsageResponse,
} from "@vimla/contracts";

export class ChatWorkspaceStore {
  usage: UsageResponse | null = null;
  models: RetailAiModel[] = [];
  conversations: ConversationSummary[] = [];
  activeConversationId: string | null = null;
  messages: ChatMessage[] = [];
  selectedModelId = "";
  draft = "";
  streaming = false;
  error: string | null = null;
  private streamingMessageId: string | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  hydrate(
    usage: UsageResponse,
    models: RetailAiModel[],
    conversations: ConversationSummary[],
  ): void {
    this.usage = usage;
    this.models = models;
    this.conversations = conversations;
    this.selectedModelId = models[0]?.id ?? "";
  }

  setUsage(usage: UsageResponse): void {
    this.usage = usage;
  }

  setModel(modelId: string): void {
    this.selectedModelId = modelId;
  }

  setDraft(value: string): void {
    this.draft = value;
  }

  addConversation(conversation: ConversationSummary): void {
    this.conversations = [conversation, ...this.conversations.filter((item) => item.id !== conversation.id)];
    this.activeConversationId = conversation.id;
    this.messages = [];
  }

  setActiveConversation(id: string, messages: ChatMessage[]): void {
    this.activeConversationId = id;
    this.messages = messages;
    this.error = null;
  }

  beginUserMessage(content: string): void {
    const now = new Date().toISOString();
    this.messages = [
      ...this.messages,
      {
        id: `local-user-${now}`,
        role: "USER",
        content,
        status: "COMPLETE",
        createdAt: now,
      },
      {
        id: `local-assistant-${now}`,
        role: "ASSISTANT",
        content: "",
        status: "STREAMING",
        createdAt: now,
      },
    ];
    this.streamingMessageId = `local-assistant-${now}`;
    this.draft = "";
    this.streaming = true;
    this.error = null;
  }

  appendAssistantDelta(text: string): void {
    this.messages = this.messages.map((message) =>
      message.id === this.streamingMessageId
        ? { ...message, content: `${message.content}${text}` }
        : message,
    );
  }

  finishAssistant(): void {
    this.messages = this.messages.map((message) =>
      message.id === this.streamingMessageId ? { ...message, status: "COMPLETE" } : message,
    );
    this.streaming = false;
    this.streamingMessageId = null;
  }

  failAssistant(code: string): void {
    this.error = code;
    this.streaming = false;
    this.messages = this.messages.map((message) =>
      message.id === this.streamingMessageId ? { ...message, status: "FAILED" } : message,
    );
    this.streamingMessageId = null;
  }
}
