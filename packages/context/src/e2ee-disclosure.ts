import type { Prisma } from "@vimla/database";
import { ContextValidationError } from "./errors.js";
import { fingerprintContextItem, fingerprintContextSnapshot } from "./fingerprint.js";
import type { ContextSnapshotItemInput } from "./types.js";

export const E2EE_CONTEXT_PROVENANCE = "E2EE_CLIENT_DISCLOSURE" as const;
export const E2EE_MEMORY_DISCLOSURE_PROVENANCE = "E2EE_USER_DISCLOSURE" as const;

export interface DirectOperatorDisclosureMessage {
  messageId: string;
  senderUserId: string;
  sentAt: string;
  text: string;
}

export interface FreezeDirectOperatorContextInput {
  operatorRunId: string;
  actorUserId: string;
  directConversationId: string;
  sourceMessageId: string;
  sourceMessageCreatedAt: string;
  userText: string;
  messages: readonly DirectOperatorDisclosureMessage[];
}

export interface FrozenDirectOperatorContext {
  sourceMessageId: string;
  sourceMessageCreatedAt: string;
  messages: DirectOperatorDisclosureMessage[];
}

export async function freezeDirectOperatorContextSnapshot(
  tx: Prisma.TransactionClient,
  input: FreezeDirectOperatorContextInput,
): Promise<void> {
  const items = buildDirectOperatorContextItems(input);
  await tx.contextSnapshot.create({
    data: {
      operatorRunId: input.operatorRunId,
      version: 1,
      fingerprint: fingerprintContextSnapshot(items),
      items: {
        create: items.map((item, sequence) => ({
          sequence,
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          sourceVersion: item.sourceVersion ?? null,
          fingerprint: fingerprintContextItem(item),
          classification: item.classification,
          contentRef: item.contentRef ?? null,
          metadata:
            item.metadata === undefined || item.metadata === null
              ? Prisma.JsonNull
              : item.metadata,
        })),
      },
    },
  });
}

export async function loadDirectOperatorContextSnapshot(
  db: Prisma.TransactionClient,
  actorUserId: string,
  operatorRunId: string,
): Promise<FrozenDirectOperatorContext | null> {
  const snapshot = await db.contextSnapshot.findFirst({
    where: {
      operatorRunId,
      operatorRun: { userId: actorUserId },
    },
    include: { items: true },
  });
  if (!snapshot) return null;

  const disclosureItems = snapshot.items.filter(
    (item) => item.sourceType === "E2EE_DISCLOSURE",
  );
  const current = disclosureItems.find(
    (item) => record(item.metadata)?.disclosureKind === "CURRENT_REQUEST",
  );
  if (!current?.sourceVersion) {
    throw new ContextValidationError(
      "Frozen Direct Chat context is missing its source invocation",
    );
  }

  const messages = disclosureItems
    .filter((item) => record(item.metadata)?.disclosureKind === "L1_RAW")
    .map((item): DirectOperatorDisclosureMessage => {
      const metadata = record(item.metadata);
      return {
        messageId: item.sourceId,
        senderUserId: boundedString(
          metadata?.senderUserId,
          "frozen Direct Chat sender",
        ),
        sentAt: boundedString(
          metadata?.sentAt,
          "frozen Direct Chat timestamp",
        ),
        text: boundedString(
          metadata?.text,
          "frozen Direct Chat plaintext",
          4_000,
        ),
      };
    });

  return {
    sourceMessageId: current.sourceId,
    sourceMessageCreatedAt: current.sourceVersion,
    messages,
  };
}

export function buildDirectOperatorContextItems(
  input: FreezeDirectOperatorContextInput,
): ContextSnapshotItemInput[] {
  const current: ContextSnapshotItemInput = {
    sourceType: "E2EE_DISCLOSURE",
    sourceId: input.sourceMessageId,
    sourceVersion: input.sourceMessageCreatedAt,
    classification: "PRIVATE",
    metadata: disclosureMetadata(input, {
      disclosureKind: "CURRENT_REQUEST",
      senderUserId: input.actorUserId,
      sentAt: input.sourceMessageCreatedAt,
      text: input.userText,
      sourceKind: "IMMEDIATE",
      directReference: true,
    }),
  };

  const history = input.messages.map(
    (message): ContextSnapshotItemInput => ({
      sourceType: "E2EE_DISCLOSURE",
      sourceId: message.messageId,
      sourceVersion: message.sentAt,
      classification: "PRIVATE",
      metadata: disclosureMetadata(input, {
        disclosureKind: "L1_RAW",
        senderUserId: message.senderUserId,
        sentAt: message.sentAt,
        text: message.text,
        sourceKind: "L1_RAW",
        directReference: false,
      }),
    }),
  );
  return [current, ...history];
}

function disclosureMetadata(
  input: FreezeDirectOperatorContextInput,
  message: {
    disclosureKind: "CURRENT_REQUEST" | "L1_RAW";
    senderUserId: string;
    sentAt: string;
    text: string;
    sourceKind: "IMMEDIATE" | "L1_RAW";
    directReference: boolean;
  },
): Prisma.InputJsonValue {
  const estimatedTokens = estimateTokens(message.text);
  return {
    provenance: E2EE_CONTEXT_PROVENANCE,
    disclosureKind: message.disclosureKind,
    senderUserId: message.senderUserId,
    senderRole: message.senderUserId === input.actorUserId ? "self" : "peer",
    sentAt: message.sentAt,
    text: message.text,
    retrieval: {
      sourceKind: message.sourceKind,
      scope: {
        kind: "DIRECT_CHAT",
        directConversationId: input.directConversationId,
      },
      reason:
        message.disclosureKind === "CURRENT_REQUEST"
          ? "current E2EE Direct Chat invocation disclosed by the client"
          : "client-selected E2EE Direct Chat context",
      lexicalScore: message.directReference ? 1 : 0,
      directReference: message.directReference,
      currentSurface: true,
      currentProject: false,
      authority: "RAW",
      occurredAt: message.sentAt,
      estimatedTokens,
      rawHistoryTokens: message.sourceKind === "L1_RAW" ? estimatedTokens : 0,
      stale: false,
      superseded: false,
    },
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedString(value: unknown, field: string, maxLength = 512): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new ContextValidationError(field + " is invalid");
  }
  return value;
}

function estimateTokens(value: string): number {
  return Math.max(1, new TextEncoder().encode(value).byteLength);
}
