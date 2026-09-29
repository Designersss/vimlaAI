import { makeAutoObservable } from "mobx";
import type {
  ChatMessage,
  ConversationDefaultTarget,
  ConversationSummary,
  DirectConversationSummary,
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
  conversations: ConversationSummary[] = [];
  directConversations: DirectConversationSummary[] = [];
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

  setConversations(conversations: ConversationSummary[]): void {
    this.conversations = conversations;
  }

  hydrateDirectConversations(conversations: DirectConversationSummary[]): void {
    // A cold detail can finish marking a chat read before the initial list arrives.
    // Preserve those newer server responses while adding the rest of the list.
    const merged = new Map(conversations.map((conversation) => [conversation.id, conversation]));
    for (const conversation of this.directConversations) merged.set(conversation.id, conversation);
    this.directConversations = [...merged.values()];
  }

  updateDirectConversation(conversation: DirectConversationSummary): void {
    const exists = this.directConversations.some((item) => item.id === conversation.id);
    this.directConversations = exists
      ? this.directConversations.map((item) => item.id === conversation.id ? conversation : item)
      : [conversation, ...this.directConversations];
  }

  setUsage(usage: UsageResponse): void {
    this.usage = usage;
  }

  setModel(modelId: string): void {
    this.selectedModelId = modelId;
  }

  addConversation(conversation: ConversationSummary): void {
    this.conversations = [conversation, ...this.conversations.filter((item) => item.id !== conversation.id)];
  }
}
