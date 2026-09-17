import { concatBytes, utf8, bytesToB64, b64ToBytes } from "./bytes.js";
import { signDirectMessage, verifyDirectMessage, type IdentityKeyPair } from "./keys.js";
import {
  decodeHeader,
  encodeHeader,
  ratchetDecrypt,
  ratchetEncrypt,
  type RatchetState,
} from "./ratchet.js";
import type { X3dhInitHeader } from "./x3dh.js";

export const DIRECT_MESSAGE_KINDS = [
  "HUMAN",
  "OPERATOR_INVOKE",
  "OPERATOR_RESPONSE",
  "OPERATOR_ACTION",
] as const;
export type DirectMessageKind = (typeof DIRECT_MESSAGE_KINDS)[number];

export interface DirectRoutingMention {
  handleId: string;
  kind: string;
  canonicalHandle: string;
  startOffset: number;
  endOffset: number;
}

export interface EnvelopeAssociatedData {
  conversationId: string;
  senderUserId: string;
  senderDeviceId: string;
  recipientDeviceId: string;
  kind: DirectMessageKind;
  routingContext?: string;
}

export interface WireEnvelope {
  headerB64: string;
  ciphertextB64: string;
  dhPublicB64: string;
  messageNumber: number;
  previousChainLength: number;
  senderSignatureB64: string;
  x3dhInit: X3dhInitHeader | null;
}

export function serializeDirectRoutingMentions(mentions: DirectRoutingMention[]): string {
  return JSON.stringify(
    [...mentions]
      .sort((left, right) =>
        left.startOffset - right.startOffset ||
        left.endOffset - right.endOffset ||
        left.handleId.localeCompare(right.handleId),
      )
      .map((mention) => ({
        handleId: mention.handleId,
        kind: mention.kind,
        canonicalHandle: mention.canonicalHandle,
        startOffset: mention.startOffset,
        endOffset: mention.endOffset,
      })),
  );
}

export function buildAssociatedData(input: EnvelopeAssociatedData): Uint8Array {
  const base = [
    input.conversationId,
    input.senderUserId,
    input.senderDeviceId,
    input.recipientDeviceId,
    input.kind,
  ];
  if (!input.routingContext) {
    return utf8(["VimlaDirectAD1", ...base].join(":"));
  }
  return utf8(JSON.stringify(["VimlaDirectAD2", ...base, input.routingContext]));
}

export function encryptEnvelope(input: {
  identity: IdentityKeyPair;
  state: RatchetState;
  plaintext: Uint8Array;
  ad: EnvelopeAssociatedData;
  x3dhInit?: X3dhInitHeader | null;
}): WireEnvelope {
  const associated = buildAssociatedData(input.ad);
  const { header, ciphertext } = ratchetEncrypt(input.state, input.plaintext, associated);
  const headerBytes = encodeHeader(header);
  const signature = signDirectMessage(
    input.identity.ed25519Secret,
    signaturePayload(headerBytes, ciphertext, associated, input.x3dhInit ?? null),
  );
  return {
    headerB64: bytesToB64(headerBytes),
    ciphertextB64: bytesToB64(ciphertext),
    dhPublicB64: bytesToB64(header.dhPublic),
    messageNumber: header.n,
    previousChainLength: header.pn,
    senderSignatureB64: bytesToB64(signature),
    x3dhInit: input.x3dhInit ?? null,
  };
}

export function decryptEnvelope(input: {
  senderIdentityEd25519Public: Uint8Array;
  state: RatchetState;
  envelope: WireEnvelope;
  ad: EnvelopeAssociatedData;
}): Uint8Array {
  const headerBytes = b64ToBytes(input.envelope.headerB64);
  const ciphertext = b64ToBytes(input.envelope.ciphertextB64);
  const associated = buildAssociatedData(input.ad);
  const signature = b64ToBytes(input.envelope.senderSignatureB64);
  if (
    !verifyDirectMessage(
      input.senderIdentityEd25519Public,
      signaturePayload(headerBytes, ciphertext, associated, input.envelope.x3dhInit),
      signature,
    )
  ) {
    throw new Error("Sender signature is invalid");
  }
  const header = decodeHeader(headerBytes);
  return ratchetDecrypt(input.state, header, ciphertext, associated);
}

export function signaturePayload(
  header: Uint8Array,
  ciphertext: Uint8Array,
  associatedData: Uint8Array,
  x3dhInit: X3dhInitHeader | null,
): Uint8Array {
  return concatBytes(
    utf8("VimlaDirectV1"),
    header,
    ciphertext,
    associatedData,
    utf8(x3dhInit ? JSON.stringify(x3dhInit) : ""),
  );
}
