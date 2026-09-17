import { z } from "zod";
import { messageMentionInputSchema, messageMentionViewSchema } from "./mentions.js";

export const DIRECT_CHAT_LIMITS = {
  ciphertextMax: 65_536,
  headerMax: 4_096,
  signatureMax: 256,
  envelopesMax: 32,
  mentionsMax: 32,
  pageLimitDefault: 30,
  pageLimitMax: 50,
  contextMessagesMax: 16,
  contextTextMax: 4_000,
  prekeysMax: 32,
  deviceLabelMax: 80,
  peerEmailMax: 254,
} as const;

export const directMessageKindSchema = z.enum([
  "HUMAN",
  "OPERATOR_INVOKE",
  "OPERATOR_RESPONSE",
  "OPERATOR_ACTION",
]);
export type DirectMessageKind = z.infer<typeof directMessageKindSchema>;

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
    peerEmail: z.string().trim().email().max(DIRECT_CHAT_LIMITS.peerEmailMax),
  })
  .strict();
export type CreateDirectConversation = z.infer<typeof createDirectConversationSchema>;

export const sendDirectMessageSchema = z
  .object({
    clientMessageId: z.string().uuid(),
    senderDeviceId: z.string().uuid(),
    kind: directMessageKindSchema,
    envelopes: z.array(wireEnvelopeSchema).min(1).max(DIRECT_CHAT_LIMITS.envelopesMax),
    mentions: z.array(messageMentionInputSchema).max(DIRECT_CHAT_LIMITS.mentionsMax).default([]),
  })
  .strict();
export type SendDirectMessage = z.infer<typeof sendDirectMessageSchema>;

export const listDirectConversationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(DIRECT_CHAT_LIMITS.pageLimitMax).default(DIRECT_CHAT_LIMITS.pageLimitDefault),
  cursor: z.string().min(1).max(512).optional(),
});

export const listDirectMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(DIRECT_CHAT_LIMITS.pageLimitMax).default(DIRECT_CHAT_LIMITS.pageLimitDefault),
  cursor: z.string().min(1).max(512).optional(),
  deviceId: z.string().uuid(),
});

export const updateDirectChatPrivacySchema = z
  .object({
    shareOwnHistoryWithVimla: z.boolean().optional(),
    includePeerHistoryWhenInvoking: z.boolean().optional(),
  })
  .strict();
export type UpdateDirectChatPrivacy = z.infer<typeof updateDirectChatPrivacySchema>;

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
  name: z.string(),
  email: z.string().email(),
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
  peer: directParticipantSchema,
  lastMessageAt: z.string(),
  unreadCount: z.number().int().min(0),
  lastKind: directMessageKindSchema.nullable(),
  lastSenderUserId: z.string().nullable(),
  createdAt: z.string(),
  privacy: directConversationPrivacySchema,
});
export type DirectConversationSummary = z.infer<typeof directConversationSummarySchema>;

export const directConversationsResponseSchema = z.object({
  items: z.array(directConversationSummarySchema),
  nextCursor: z.string().nullable(),
});
export type DirectConversationsResponse = z.infer<typeof directConversationsResponseSchema>;

export const directConversationViewSchema = directConversationSummarySchema.extend({
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
  kind: directMessageKindSchema,
  createdAt: z.string(),
  envelope: directEnvelopeViewSchema.nullable(),
  mentions: z.array(messageMentionViewSchema).default([]),
});
export type DirectMessageView = z.infer<typeof directMessageViewSchema>;

export const directMessagesResponseSchema = z.object({
  items: z.array(directMessageViewSchema),
  nextCursor: z.string().nullable(),
});
export type DirectMessagesResponse = z.infer<typeof directMessagesResponseSchema>;

export const cryptoDevicesResponseSchema = z.object({
  items: z.array(cryptoDeviceViewSchema),
});
export type CryptoDevicesResponse = z.infer<typeof cryptoDevicesResponseSchema>;

export const operatorContextMessageSchema = z
  .object({
    senderUserId: z.string().min(1).max(64),
    sentAt: z.string().datetime({ offset: true }),
    text: z.string().trim().min(1).max(DIRECT_CHAT_LIMITS.contextTextMax),
  })
  .strict();

export const operatorContextBundleSchema = z
  .object({
    messages: z.array(operatorContextMessageSchema).max(DIRECT_CHAT_LIMITS.contextMessagesMax),
  })
  .strict();
export type OperatorContextBundle = z.infer<typeof operatorContextBundleSchema>;
