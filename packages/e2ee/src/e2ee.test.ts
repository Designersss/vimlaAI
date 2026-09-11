import { describe, expect, it } from "vitest";
import { b64ToBytes } from "./bytes.js";
import {
  decryptEnvelope,
  encryptEnvelope,
  type EnvelopeAssociatedData,
} from "./envelope.js";
import {
  generateIdentity,
  generateOneTimePreKey,
  generateSignedPreKey,
  publicBundleFrom,
} from "./keys.js";
import { deserializeRatchet, initRatchetInitiator, initRatchetResponder, serializeRatchet } from "./ratchet.js";
import { x3dhInitiate, x3dhRespond } from "./x3dh.js";

function ad(kind: EnvelopeAssociatedData["kind"] = "HUMAN"): EnvelopeAssociatedData {
  return {
    conversationId: "11111111-1111-4111-8111-111111111111",
    senderUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    senderDeviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    recipientDeviceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    kind,
  };
}

describe("Vimla X3DH + Double Ratchet", () => {
  it("lets two devices encrypt and decrypt with forward secrecy", () => {
    const alice = generateIdentity();
    const bob = generateIdentity();
    const bobSigned = generateSignedPreKey(bob, 1);
    const bobOtk = generateOneTimePreKey(1);
    const bundle = publicBundleFrom("bob-device", bob, bobSigned, bobOtk);

    const initiated = x3dhInitiate(alice, bundle);
    const aliceState = initRatchetInitiator(initiated.sharedKey, initiated.remoteRatchetPublic);
    const bobShared = x3dhRespond(bob, bobSigned.secret, bobOtk.secret, initiated.initHeader);
    const bobState = initRatchetResponder(bobShared.sharedKey, {
      secret: bobSigned.secret,
      publicKey: bobSigned.publicKey,
    });

    const first = encryptEnvelope({
      identity: alice,
      state: aliceState,
      plaintext: new TextEncoder().encode("hello nikita"),
      ad: ad(),
      x3dhInit: initiated.initHeader,
    });
    expect(new TextDecoder().decode(first.ciphertextB64 ? b64ToBytes(first.ciphertextB64) : new Uint8Array())).not.toContain(
      "hello",
    );
    expect(first.ciphertextB64.includes("hello")).toBe(false);

    const opened = decryptEnvelope({
      senderIdentityEd25519Public: alice.ed25519Public,
      state: bobState,
      envelope: first,
      ad: ad(),
    });
    expect(new TextDecoder().decode(opened)).toBe("hello nikita");

    expect(() =>
      decryptEnvelope({
        senderIdentityEd25519Public: alice.ed25519Public,
        state: deserializeRatchet(serializeRatchet(bobState)),
        envelope: first,
        ad: ad(),
      }),
    ).toThrow(/authentication failed|Too many skipped|Sending chain|Receiving chain|signature/i);

    const replyAd: EnvelopeAssociatedData = {
      ...ad(),
      senderUserId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      senderDeviceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      recipientDeviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    };
    const reply = encryptEnvelope({
      identity: bob,
      state: bobState,
      plaintext: new TextEncoder().encode("secret reply"),
      ad: replyAd,
    });
    const replyPlain = decryptEnvelope({
      senderIdentityEd25519Public: bob.ed25519Public,
      state: aliceState,
      envelope: reply,
      ad: replyAd,
    });
    expect(new TextDecoder().decode(replyPlain)).toBe("secret reply");
  });

  it("rejects ciphertext tampering and sender-signature spoofing", () => {
    const alice = generateIdentity();
    const bob = generateIdentity();
    const bobSigned = generateSignedPreKey(bob, 1);
    const bundle = publicBundleFrom("bob-device", bob, bobSigned, null);
    const initiated = x3dhInitiate(alice, bundle);
    const aliceState = initRatchetInitiator(initiated.sharedKey, initiated.remoteRatchetPublic);
    const bobShared = x3dhRespond(bob, bobSigned.secret, null, initiated.initHeader);
    const bobState = initRatchetResponder(bobShared.sharedKey, {
      secret: bobSigned.secret,
      publicKey: bobSigned.publicKey,
    });
    const envelope = encryptEnvelope({
      identity: alice,
      state: aliceState,
      plaintext: new TextEncoder().encode("classified"),
      ad: ad(),
      x3dhInit: initiated.initHeader,
    });

    const tampered = { ...envelope, ciphertextB64: bytesFlip(envelope.ciphertextB64) };
    expect(() =>
      decryptEnvelope({
        senderIdentityEd25519Public: alice.ed25519Public,
        state: bobState,
        envelope: tampered,
        ad: ad(),
      }),
    ).toThrow();

    const stranger = generateIdentity();
    expect(() =>
      decryptEnvelope({
        senderIdentityEd25519Public: stranger.ed25519Public,
        state: bobState,
        envelope,
        ad: ad(),
      }),
    ).toThrow(/signature/i);
  });

  it("does not let an unrelated identity decrypt a pairwise session", () => {
    const alice = generateIdentity();
    const bob = generateIdentity();
    const eve = generateIdentity();
    const bobSigned = generateSignedPreKey(bob, 1);
    const bundle = publicBundleFrom("bob-device", bob, bobSigned, null);
    const initiated = x3dhInitiate(alice, bundle);
    const aliceState = initRatchetInitiator(initiated.sharedKey, initiated.remoteRatchetPublic);
    const envelope = encryptEnvelope({
      identity: alice,
      state: aliceState,
      plaintext: new TextEncoder().encode("only for bob"),
      ad: ad(),
      x3dhInit: initiated.initHeader,
    });

    const eveSigned = generateSignedPreKey(eve, 1);
    const eveShared = x3dhRespond(eve, eveSigned.secret, null, initiated.initHeader);
    const eveState = initRatchetResponder(eveShared.sharedKey, {
      secret: eveSigned.secret,
      publicKey: eveSigned.publicKey,
    });
    expect(() =>
      decryptEnvelope({
        senderIdentityEd25519Public: alice.ed25519Public,
        state: eveState,
        envelope,
        ad: ad(),
      }),
    ).toThrow();
  });

  it("decrypts out-of-order messages and then rejects a replay", () => {
    const alice = generateIdentity();
    const bob = generateIdentity();
    const bobSigned = generateSignedPreKey(bob, 1);
    const bundle = publicBundleFrom("bob-device", bob, bobSigned, null);
    const initiated = x3dhInitiate(alice, bundle);
    const aliceState = initRatchetInitiator(initiated.sharedKey, initiated.remoteRatchetPublic);
    const bobShared = x3dhRespond(bob, bobSigned.secret, null, initiated.initHeader);
    const bobState = initRatchetResponder(bobShared.sharedKey, {
      secret: bobSigned.secret,
      publicKey: bobSigned.publicKey,
    });
    const one = encryptEnvelope({
      identity: alice,
      state: aliceState,
      plaintext: new TextEncoder().encode("one"),
      ad: ad(),
      x3dhInit: initiated.initHeader,
    });
    const two = encryptEnvelope({
      identity: alice,
      state: aliceState,
      plaintext: new TextEncoder().encode("two"),
      ad: ad(),
    });
    expect(new TextDecoder().decode(decryptEnvelope({
      senderIdentityEd25519Public: alice.ed25519Public,
      state: bobState,
      envelope: two,
      ad: ad(),
    }))).toBe("two");
    expect(new TextDecoder().decode(decryptEnvelope({
      senderIdentityEd25519Public: alice.ed25519Public,
      state: bobState,
      envelope: one,
      ad: ad(),
    }))).toBe("one");
    expect(() =>
      decryptEnvelope({
        senderIdentityEd25519Public: alice.ed25519Public,
        state: bobState,
        envelope: two,
        ad: ad(),
      }),
    ).toThrow();
  });
});

function bytesFlip(value: string): string {
  const bytes = b64ToBytes(value);
  bytes[0] = (bytes[0] ?? 0) ^ 0xff;
  return Buffer.from(bytes).toString("base64");
}
