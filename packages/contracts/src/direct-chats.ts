import { z } from "zod";
import { handleInputSchema, handleSchema } from "./handles.js";
import { messageMentionInputSchema, messageMentionViewSchema } from "./mentions.js";
import {
  publicProfileAvatarUrlSchema,
  publicProfileDisplayNameSchema,
} from "./public-profiles.js";

export const DIRECT_CHAT_LIMITS = {
  ciphertextMax: 65_536,
  interactionEpochMax: 2_000_000_000,
  headerMax: 4_096,
  signatureMax: 256,
  envelopesMax: 32,
  mentionsMax: 32,
  pageLimitDefault: 30,
  pageLimitMax: 50,
  contextMessagesMax: 16,
  contextTextMax: 4_000,
  contextCharsMax: 32_000,
  prekeysMax: 32,
  deviceLabelMax: 80,
} as const;

export const directMessageKindSchema = z.enum([
  "HUMAN",
  "REACTION",
  "OPERATOR_INVOKE",
  "OPERATOR_RESPONSE",
  "OPERATOR_ACTION",
]);
export type DirectMessageKind = z.infer<typeof directMessageKindSchema>;

// Every persisted Direct sequence is a PostgreSQL signed bigint. Bound the
// decimal length before any client converts untrusted API metadata to BigInt:
// an arbitrarily long digit string otherwise becomes a CPU/memory DoS.
const directHistorySequenceSchema = z.string()
  .max(19)
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine(
    (value) => value.length <= 19 &&
      /^(0|[1-9][0-9]*)$/.test(value) &&
      BigInt(value) <= 9223372036854775807n,
    "Direct history sequence exceeds PostgreSQL bigint",
  );

export const directInteractionEpochSchema = z
  .number()
  .int()
  .min(0)
  .max(DIRECT_CHAT_LIMITS.interactionEpochMax);
export type DirectInteractionEpoch = z.infer<typeof directInteractionEpochSchema>;

const b64Schema = z.string().min(8).max(DIRECT_CHAT_LIMITS.ciphertextMax);

export const x3dhInitHeaderSchema = z
  .object({
    identityEd25519Public: z.string().min(16).max(128),
    identityX25519Public: z.string().min(16).max(128),
    ephemeralPublic: z.string().min(16).max(128),
    signedPrekeyId: z.number().int().min(1).max(1_000_000),
    oneTimePrekeyId: z.number().int().min(1).max(1_000_000).nullable(),
  })
  .strict();

export const wireEnvelopeSchema = z
  .object({
    recipientDeviceId: z.string().uuid(),
    headerB64: z.string().min(8).max(DIRECT_CHAT_LIMITS.headerMax),
    ciphertextB64: b64Schema,
    dhPublicB64: z.string().min(16).max(128),
    messageNumber: z.number().int().min(0).max(2_000_000_000),
    previousChainLength: z.number().int().min(0).max(2_000_000_000),
    senderSignatureB64: z.string().min(16).max(DIRECT_CHAT_LIMITS.signatureMax),
    x3dhInit: x3dhInitHeaderSchema.nullable().optional(),
  })
  .strict();
export type WireEnvelopeDto = z.infer<typeof wireEnvelopeSchema>;

export const registerCryptoDeviceSchema = z
  .object({
    deviceId: z.string().uuid(),
    identityEd25519Public: z.string().min(16).max(128),
    identityX25519Public: z.string().min(16).max(128),
    signedPrekeyId: z.number().int().min(1).max(1_000_000),
    signedPrekeyPublic: z.string().min(16).max(128),
    signedPrekeySignature: z.string().min(16).max(256),
    oneTimePrekeys: z
      .array(
        z
          .object({
            keyId: z.number().int().min(1).max(1_000_000),
            publicKey: z.string().min(16).max(128),
          })
          .strict(),
      )
      .min(1)
      .max(DIRECT_CHAT_LIMITS.prekeysMax),
    label: z.string().trim().max(DIRECT_CHAT_LIMITS.deviceLabelMax).optional(),
  })
  .strict();
export type RegisterCryptoDevice = z.infer<typeof registerCryptoDeviceSchema>;

export const rotatePrekeysSchema = z
  .object({
    signedPrekeyId: z.number().int().min(1).max(1_000_000),
    signedPrekeyPublic: z.string().min(16).max(128),
    signedPrekeySignature: z.string().min(16).max(256),
    oneTimePrekeys: z
      .array(
        z
          .object({
            keyId: z.number().int().min(1).max(1_000_000),
            publicKey: z.string().min(16).max(128),
          })
          .strict(),
      )
      .min(1)
      .max(DIRECT_CHAT_LIMITS.prekeysMax),
  })
  .strict();
export type RotatePrekeys = z.infer<typeof rotatePrekeysSchema>;

export const createDirectConversationSchema = z
  .object({
    peerHandle: handleInputSchema,
  })
  .strict();
export type CreateDirectConversation = z.infer<typeof createDirectConversationSchema>;

export const prepareDirectMessageSendSchema = z
  .object({
    senderDeviceId: z.string().uuid(),
  })
  .strict();
export type PrepareDirectMessageSend = z.infer<typeof prepareDirectMessageSendSchema>;

export const directMessageSendPreflightSchema = z
  .object({
    interactionEpoch: directInteractionEpochSchema,
  })
  .strict();
export type DirectMessageSendPreflight = z.infer<typeof directMessageSendPreflightSchema>;

export const sendDirectMessageSchema = z
  .object({
    clientMessageId: z.string().uuid(),
    contentCommitmentB64: z.string().length(44).nullable().default(null),
    // An opaque source-derived lookup tag, never an unencrypted source reference.
    reactionTargetTagB64: z.string().regex(/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/).nullable().optional(),
    senderDeviceId: z.string().uuid(),
    interactionEpoch: directInteractionEpochSchema,
    kind: directMessageKindSchema,
    envelopes: z.array(wireEnvelopeSchema).min(1).max(DIRECT_CHAT_LIMITS.envelopesMax),
    mentions: z.array(messageMentionInputSchema).max(DIRECT_CHAT_LIMITS.mentionsMax).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "REACTION") {
      if (!value.reactionTargetTagB64 || !value.contentCommitmentB64) {
        ctx.addIssue({ code: "custom", path: ["reactionTargetTagB64"], message: "Signed reaction commitment and target tag are required" });
      }
      if (value.mentions.length > 0) {
        ctx.addIssue({ code: "custom", path: ["mentions"], message: "Reactions cannot include routing mentions" });
      }
    } else if (value.reactionTargetTagB64 != null) {
      ctx.addIssue({ code: "custom", path: ["reactionTargetTagB64"], message: "Only reactions may supply a target tag" });
    }
  });
export type SendDirectMessage = z.infer<typeof sendDirectMessageSchema>;

export const listDirectMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(DIRECT_CHAT_LIMITS.pageLimitMax).default(DIRECT_CHAT_LIMITS.pageLimitDefault),
  cursor: z.string().min(1).max(512).optional(),
  deviceId: z.string().uuid(),
});

/**
 * Indexed E2EE reaction-event discovery. This does NOT decrypt ciphertext
 * or establish the latest reaction state: a client must verify the original,
 * ratchet chronology, event commitment and causal completeness separately.
 * Tags are opaque HMACs derived exclusively from authenticated HUMAN v2.
 */
export const DIRECT_REACTION_HISTORY_PAGE_MAX = 50;
export const listDirectReactionEventsQuerySchema = z.object({
  deviceId: z.string().uuid(),
  targetTagB64: z.string().regex(/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/),
  // Never transmit the original HUMAN sequence: it would deanonymize the
  // opaque HMAC tag by pointing the server to the exact source row.
  // Opaque same-conversation causal cursor for older matching events.
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(DIRECT_REACTION_HISTORY_PAGE_MAX).default(30),
}).strict();
export type ListDirectReactionEventsQuery = z.infer<typeof listDirectReactionEventsQuerySchema>;

export const updateDirectChatPrivacySchema = z
  .object({
    shareOwnHistoryWithVimla: z.boolean().optional(),
    includePeerHistoryWhenInvoking: z.boolean().optional(),
  })
  .strict();
export type UpdateDirectChatPrivacy = z.infer<typeof updateDirectChatPrivacySchema>;

export const markDirectChatReadSchema = z
  .object({
    seenMessageIds: z
      .array(z.string().uuid())
      .max(DIRECT_CHAT_LIMITS.pageLimitMax),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.seenMessageIds).size !== value.seenMessageIds.length) {
      ctx.addIssue({
        code: "custom",
        path: ["seenMessageIds"],
        message: "Seen Direct Chat message ids must be unique",
      });
    }
  });
export type MarkDirectChatRead = z.infer<typeof markDirectChatReadSchema>;

export const cryptoDeviceViewSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  identityEd25519Public: z.string(),
  identityX25519Public: z.string(),
  signedPrekeyId: z.number().int(),
  signedPrekeyPublic: z.string(),
  signedPrekeySignature: z.string(),
  revoked: z.boolean(),
  createdAt: z.string(),
});
export type CryptoDeviceView = z.infer<typeof cryptoDeviceViewSchema>;

export const prekeyBundleSchema = z.object({
  deviceId: z.string().uuid(),
  identityEd25519Public: z.string(),
  identityX25519Public: z.string(),
  signedPrekeyId: z.number().int(),
  signedPrekeyPublic: z.string(),
  signedPrekeySignature: z.string(),
  oneTimePrekeyId: z.number().int().nullable(),
  oneTimePrekeyPublic: z.string().nullable(),
});
export type PrekeyBundle = z.infer<typeof prekeyBundleSchema>;

export const prekeyBundlesResponseSchema = z.object({
  userId: z.string(),
  bundles: z.array(prekeyBundleSchema),
});
export type PrekeyBundlesResponse = z.infer<typeof prekeyBundlesResponseSchema>;

export const directParticipantSchema = z.object({
  userId: z.string(),
  handle: handleSchema,
  name: publicProfileDisplayNameSchema,
  avatarUrl: publicProfileAvatarUrlSchema,
});
export type DirectParticipant = z.infer<typeof directParticipantSchema>;

export const directConversationPrivacySchema = z.object({
  shareOwnHistoryWithVimla: z.boolean(),
  includePeerHistoryWhenInvoking: z.boolean(),
  peerShareOwnHistoryWithVimla: z.boolean(),
});
export type DirectConversationPrivacy = z.infer<typeof directConversationPrivacySchema>;

export const directConversationSummarySchema = z.object({
  id: z.string().uuid(),
  surfaceId: z.string().uuid(),
  surfaceKind: z.literal("DIRECT"),
  peer: directParticipantSchema,
  lastMessageAt: z.string(),
  unreadCount: z.number().int().min(0),
  lastKind: directMessageKindSchema.nullable(),
  lastSenderUserId: z.string().nullable(),
  createdAt: z.string(),
  interactionEpoch: directInteractionEpochSchema,
  blockedByMe: z.boolean(),
  privacy: directConversationPrivacySchema,
});
export type DirectConversationSummary = z.infer<typeof directConversationSummarySchema>;

export const directConversationViewSchema = directConversationSummarySchema.extend({
  // Includes encrypted reaction control events, not just visible chat messages.
  lastMessageSequence: directHistorySequenceSchema,
  members: z.array(directParticipantSchema),
  devices: z.array(cryptoDeviceViewSchema),
});
export type DirectConversationView = z.infer<typeof directConversationViewSchema>;

export const directEnvelopeViewSchema = z.object({
  recipientDeviceId: z.string().uuid(),
  headerB64: z.string(),
  ciphertextB64: z.string(),
  dhPublicB64: z.string(),
  messageNumber: z.number().int(),
  previousChainLength: z.number().int(),
  senderSignatureB64: z.string(),
  x3dhInit: x3dhInitHeaderSchema.nullable(),
});
export type DirectEnvelopeView = z.infer<typeof directEnvelopeViewSchema>;

export const directMessageViewSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  senderUserId: z.string(),
  senderDeviceId: z.string().uuid(),
  clientMessageId: z.string().uuid(),
  contentCommitmentB64: z.string().length(44).nullable(),
  reactionTargetTagB64: z.string().regex(/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/).nullable(),
  kind: directMessageKindSchema,
  interactionEpoch: directInteractionEpochSchema,
  // PostgreSQL-authoritative causal order, serialized as decimal for bigint safety.
  sequence: directHistorySequenceSchema.refine((value) => value !== "0"),
  createdAt: z.string(),
  envelope: directEnvelopeViewSchema.nullable(),
  mentions: z.array(messageMentionViewSchema).default([]),
});
export type DirectMessageView = z.infer<typeof directMessageViewSchema>;

// Actor-scoped, non-mutating reconciliation for ambiguous local E2EE sends.
// Absence is authoritative only when the caller also proves the old
// interaction epoch can no longer accept a new commit.
export const lookupOwnDirectMessageQuerySchema = z
  .object({
    senderDeviceId: z.string().uuid(),
    clientMessageId: z.string().uuid(),
  })
  .strict();
export type LookupOwnDirectMessageQuery = z.infer<
  typeof lookupOwnDirectMessageQuerySchema
>;

export const lookupOwnDirectMessageResponseSchema = z.discriminatedUnion(
  "status",
  [
    z.object({ status: z.literal("ABSENT") }).strict(),
    z.object({
      status: z.literal("COMMITTED"),
      message: directMessageViewSchema,
    }).strict(),
  ],
);
export type LookupOwnDirectMessageResponse = z.infer<
  typeof lookupOwnDirectMessageResponseSchema
>;

export const directMessagesResponseSchema = z.object({
  items: z.array(directMessageViewSchema),
  nextCursor: z.string().nullable(),
});
export type DirectMessagesResponse = z.infer<typeof directMessagesResponseSchema>;

export const directReactionEventsResponseSchema = z.object({
  items: z.array(directMessageViewSchema).max(DIRECT_REACTION_HISTORY_PAGE_MAX),
  nextCursor: z.string().min(1).max(512).nullable(),
});
export type DirectReactionEventsResponse = z.infer<typeof directReactionEventsResponseSchema>;



export const cryptoDevicesResponseSchema = z.object({
  items: z.array(cryptoDeviceViewSchema),
});
export type CryptoDevicesResponse = z.infer<typeof cryptoDevicesResponseSchema>;

export const operatorContextMessageSchema = z
  .object({
    messageId: z.string().uuid(),
    senderUserId: z.string().min(1).max(64),
    sentAt: z.string().datetime({ offset: true }),
    text: z.string().trim().min(1).max(DIRECT_CHAT_LIMITS.contextTextMax),
  })
  .strict();

export const operatorContextBundleSchema = z
  .object({
    messages: z.array(operatorContextMessageSchema).max(DIRECT_CHAT_LIMITS.contextMessagesMax),
  })
  .strict()
  .superRefine((value, ctx) => {
    const messageIds = new Set<string>();
    let aggregateChars = 0;
    value.messages.forEach((message, index) => {
      if (messageIds.has(message.messageId)) {
        ctx.addIssue({
          code: "custom",
          path: ["messages", index, "messageId"],
          message: "Direct Chat context message ids must be unique",
        });
      }
      messageIds.add(message.messageId);
      aggregateChars += message.text.length;
    });
    if (aggregateChars > DIRECT_CHAT_LIMITS.contextCharsMax) {
      ctx.addIssue({
        code: "custom",
        path: ["messages"],
        message: "Direct Chat context is too large",
      });
    }
  });
export type OperatorContextBundle = z.infer<typeof operatorContextBundleSchema>;
