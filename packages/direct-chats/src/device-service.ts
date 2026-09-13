import type { CryptoDeviceView, PrekeyBundle, RegisterCryptoDevice, RotatePrekeys } from "@vimla/contracts";
import { b64ToBytes, verifySignedPreKey } from "@vimla/e2ee";
import { DirectChatError } from "./errors.js";
import type { ActorContext, DbClient } from "./types.js";

export class DeviceService {
  constructor(private readonly db: DbClient) {}

  async register(actor: ActorContext, input: RegisterCryptoDevice): Promise<CryptoDeviceView> {
    assertSignedPrekey(input.identityEd25519Public, input.signedPrekeyId, input.signedPrekeyPublic, input.signedPrekeySignature);
    const existing = await this.db.userCryptoDevice.findUnique({ where: { id: input.deviceId } });
    if (existing && existing.userId !== actor.userId) {
      throw new DirectChatError("FORBIDDEN", "Device id is already registered");
    }
    if (existing?.revokedAt) {
      throw new DirectChatError("DEVICE_REVOKED", "This device was revoked");
    }

    const saved = await this.db.userCryptoDevice.upsert({
      where: { id: input.deviceId },
      create: {
        id: input.deviceId,
        userId: actor.userId,
        identityEd25519Public: input.identityEd25519Public,
        identityX25519Public: input.identityX25519Public,
        signedPrekeyId: input.signedPrekeyId,
        signedPrekeyPublic: input.signedPrekeyPublic,
        signedPrekeySignature: input.signedPrekeySignature,
        label: input.label ?? null,
        oneTimePrekeys: {
          create: input.oneTimePrekeys.map((key) => ({ keyId: key.keyId, publicKey: key.publicKey })),
        },
      },
      update: {
        signedPrekeyId: input.signedPrekeyId,
        signedPrekeyPublic: input.signedPrekeyPublic,
        signedPrekeySignature: input.signedPrekeySignature,
        label: input.label ?? undefined,
      },
    });

    if (existing) {
      await this.replaceUnusedPrekeys(saved.id, input.oneTimePrekeys);
    }
    return toDeviceView(saved);
  }

  async rotate(actor: ActorContext, deviceId: string, input: RotatePrekeys): Promise<CryptoDeviceView> {
    const device = await this.requireOwnActiveDevice(actor.userId, deviceId);
    assertSignedPrekey(device.identityEd25519Public, input.signedPrekeyId, input.signedPrekeyPublic, input.signedPrekeySignature);
    const updated = await this.db.userCryptoDevice.update({
      where: { id: device.id },
      data: {
        signedPrekeyId: input.signedPrekeyId,
        signedPrekeyPublic: input.signedPrekeyPublic,
        signedPrekeySignature: input.signedPrekeySignature,
      },
    });
    await this.replaceUnusedPrekeys(device.id, input.oneTimePrekeys);
    return toDeviceView(updated);
  }

  async listMine(actor: ActorContext): Promise<CryptoDeviceView[]> {
    const rows = await this.db.userCryptoDevice.findMany({
      where: { userId: actor.userId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toDeviceView);
  }

  async revoke(actor: ActorContext, deviceId: string): Promise<CryptoDeviceView> {
    const device = await this.requireOwnDevice(actor.userId, deviceId);
    if (device.revokedAt) {
      return toDeviceView(device);
    }
    const updated = await this.db.userCryptoDevice.update({
      where: { id: device.id },
      data: { revokedAt: new Date() },
    });
    return toDeviceView(updated);
  }

  async prekeyBundlesForUser(userId: string): Promise<PrekeyBundle[]> {
    return this.db.$transaction(async (tx) => {
      const devices = await tx.userCryptoDevice.findMany({
        where: { userId, revokedAt: null },
        orderBy: { createdAt: "asc" },
      });
      const bundles: PrekeyBundle[] = [];
      for (const device of devices) {
        const claimed = await tx.$queryRaw<Array<{ keyId: number; publicKey: string }>>`
          UPDATE "direct_one_time_prekey"
          SET "consumedAt" = CURRENT_TIMESTAMP
          WHERE "id" = (
            SELECT prekey."id"
            FROM "direct_one_time_prekey" AS prekey
            JOIN "user_crypto_device" AS owner_device ON owner_device."id" = prekey."deviceId"
            WHERE prekey."deviceId" = ${device.id}
              AND prekey."consumedAt" IS NULL
              AND owner_device."userId" = ${userId}
              AND owner_device."revokedAt" IS NULL
            ORDER BY prekey."keyId" ASC
            FOR UPDATE OF prekey SKIP LOCKED
            LIMIT 1
          )
          AND "consumedAt" IS NULL
          RETURNING "keyId", "publicKey"
        `;
        const otk = claimed[0];
        bundles.push({
          deviceId: device.id,
          identityEd25519Public: device.identityEd25519Public,
          identityX25519Public: device.identityX25519Public,
          signedPrekeyId: device.signedPrekeyId,
          signedPrekeyPublic: device.signedPrekeyPublic,
          signedPrekeySignature: device.signedPrekeySignature,
          oneTimePrekeyId: otk?.keyId ?? null,
          oneTimePrekeyPublic: otk?.publicKey ?? null,
        });
      }
      return bundles;
    });
  }

  async requireOwnActiveDevice(userId: string, deviceId: string) {
    const device = await this.requireOwnDevice(userId, deviceId);
    if (device.revokedAt) {
      throw new DirectChatError("DEVICE_REVOKED", "This device was revoked");
    }
    return device;
  }

  private async requireOwnDevice(userId: string, deviceId: string) {
    const device = await this.db.userCryptoDevice.findFirst({ where: { id: deviceId, userId } });
    if (!device) {
      throw new DirectChatError("NOT_FOUND", "Device was not found");
    }
    return device;
  }

  private async replaceUnusedPrekeys(
    deviceId: string,
    keys: ReadonlyArray<{ keyId: number; publicKey: string }>,
  ): Promise<void> {
    await this.db.directOneTimePrekey.deleteMany({ where: { deviceId, consumedAt: null } });
    if (keys.length === 0) {
      return;
    }
    await this.db.directOneTimePrekey.createMany({
      data: keys.map((key) => ({ deviceId, keyId: key.keyId, publicKey: key.publicKey })),
      skipDuplicates: true,
    });
  }
}

export function toDeviceView(row: {
  id: string;
  userId: string;
  identityEd25519Public: string;
  identityX25519Public: string;
  signedPrekeyId: number;
  signedPrekeyPublic: string;
  signedPrekeySignature: string;
  revokedAt: Date | null;
  createdAt: Date;
}): CryptoDeviceView {
  return {
    id: row.id,
    userId: row.userId,
    identityEd25519Public: row.identityEd25519Public,
    identityX25519Public: row.identityX25519Public,
    signedPrekeyId: row.signedPrekeyId,
    signedPrekeyPublic: row.signedPrekeyPublic,
    signedPrekeySignature: row.signedPrekeySignature,
    revoked: row.revokedAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

function assertSignedPrekey(
  identityEd25519Public: string,
  keyId: number,
  signedPrekeyPublic: string,
  signature: string,
): void {
  try {
    const ok = verifySignedPreKey(
      b64ToBytes(identityEd25519Public),
      keyId,
      b64ToBytes(signedPrekeyPublic),
      b64ToBytes(signature),
    );
    if (!ok) {
      throw new DirectChatError("VALIDATION_ERROR", "Signed prekey is invalid");
    }
  } catch (error: unknown) {
    if (error instanceof DirectChatError) {
      throw error;
    }
    throw new DirectChatError("VALIDATION_ERROR", "Signed prekey is invalid");
  }
}
