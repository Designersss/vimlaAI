import { makeAutoObservable } from "mobx";
import type {
  ChatMessage,
  ConversationDefaultTarget,
  InboxItem,
  OperatorRunView,
  RetailAiModel,
  UsageResponse,
} from "@vimla/contracts";

/** Platform-independent state for one conversation, never a current route. */
export class ConversationState {
  messages: ChatMessage[] = [];
  draft = "";
  streaming = false;
  operatorBusy = false;
  defaultTarget: ConversationDefaultTarget | null = null;
  error: string | null = null;
  revision = 0;
  private streamingMessageId: string | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  setMessages(messages: ChatMessage[], revision: number): void {
    // A fetch started before/during a local send must not replace that send's result.
    if (this.streaming || this.revision !== revision) return;
    this.messages = messages;
    this.error = null;
  }

  setDraft(value: string): void {
    this.draft = value;
  }

  setOperatorBusy(value: boolean): void {
    this.operatorBusy = value;
  }

  setDefaultTarget(target: ConversationDefaultTarget | null): void {
    this.defaultTarget = target;
  }

  beginUserMessage(content: string): void {
    this.revision += 1;
    const now = new Date().toISOString();
    this.messages = [
      ...this.messages,
      {
        id: `local-user-${now}-${this.revision}`,
        role: "USER",
        content,
        status: "COMPLETE",
        createdAt: now,
        mentions: [],
      },
      {
        id: `local-assistant-${now}-${this.revision}`,
        role: "ASSISTANT",
        content: "",
        status: "STREAMING",
        createdAt: now,
        mentions: [],
      },
    ];
    this.streamingMessageId = `local-assistant-${now}-${this.revision}`;
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
    this.revision += 1;
    this.messages = this.messages.map((message) =>
      message.id === this.streamingMessageId ? { ...message, status: "COMPLETE" } : message,
    );
    this.streaming = false;
    this.streamingMessageId = null;
  }

  finishOperator(run: OperatorRunView): void {
    this.revision += 1;
    this.messages = this.messages.map((message) =>
      message.id === this.streamingMessageId
        ? {
            ...message,
            status: "COMPLETE",
            content: run.publicMessage ?? message.content,
            operatorRun: run,
          }
        : message,
    );
    this.streaming = false;
    this.streamingMessageId = null;
  }

  replaceOperator(run: OperatorRunView): void {
    this.revision += 1;
    this.messages = this.messages.map((message) =>
      message.operatorRun?.id === run.id
        ? { ...message, content: run.publicMessage ?? message.content, operatorRun: run }
        : message,
    );
  }

  failAssistant(code: string): void {
    this.revision += 1;
    this.error = code;
    this.streaming = false;
    this.messages = this.messages.map((message) =>
      message.id === this.streamingMessageId ? { ...message, status: "FAILED" } : message,
    );
    this.streamingMessageId = null;
  }
}

/** One instance per chat layout. Navigation and platform integrations stay outside this store. */
export class ChatWorkspaceStore {
  usage: UsageResponse | null = null;
  models: RetailAiModel[] = [];
  inboxItems: InboxItem[] = [];
  inboxNextCursor: string | null = null;
  selectedModelId = "";
  private readonly details = new Map<string, ConversationState>();

  constructor() {
    makeAutoObservable(this);
  }

  conversation(id: string): ConversationState {
    let state = this.details.get(id);
    if (!state) {
      state = new ConversationState();
      this.details.set(id, state);
    }
    return state;
  }

  hydrate(usage: UsageResponse, models: RetailAiModel[]): void {
    this.usage = usage;
    this.models = models;
    if (!models.some((model) => model.id === this.selectedModelId)) {
      this.selectedModelId = models[0]?.id ?? "";
    }
  }

  setInboxPage(
    page: {
      items: InboxItem[];
      nextCursor: string | null;
    },
    append = false,
  ): void {
    if (!append) {
      this.inboxItems = page.items;
      this.inboxNextCursor = page.nextCursor;
      return;
    }

    const existing = new Set(
      this.inboxItems.map(
        (item) => item.surfaceId,
      ),
    );
    this.inboxItems = [
      ...this.inboxItems,
      ...page.items.filter(
        (item) => !existing.has(item.surfaceId),
      ),
    ];
    this.inboxNextCursor = page.nextCursor;
  }

  setUsage(usage: UsageResponse): void {
    this.usage = usage;
  }

  setModel(modelId: string): void {
    this.selectedModelId = modelId;
  }

}
