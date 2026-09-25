import {
  DIRECT_CHAT_LIMITS,
  type CryptoDeviceView,
  type PrekeyBundle,
  type RegisterCryptoDevice,
  type RotatePrekeys,
} from "@vimla/contracts";
import type { ReplenishOneTimePrekeys } from "@vimla/contracts/direct-chats";
import { Prisma } from "@vimla/database";
import { b64ToBytes, verifySignedPreKey } from "@vimla/e2ee";
import { DirectChatError } from "./errors.js";
import type { ActorContext, DbClient } from "./types.js";

export class DeviceService {
  constructor(private readonly db: DbClient) {}

  async register(actor: ActorContext, input: RegisterCryptoDevice): Promise<CryptoDeviceView> {
    assertSignedPrekey(
      input.identityEd25519Public,
      input.signedPrekeyId,
      input.signedPrekeyPublic,
      input.signedPrekeySignature,
    );

    let existing = await this.db.userCryptoDevice.findUnique({
      where: { id: input.deviceId },
    });
    if (!existing) {
      try {
        const created = await this.createActiveDevice(
          actor.userId,
          input,
        );
        return toDeviceView(created);
      } catch (error: unknown) {
        existing = await this.db.userCryptoDevice.findUnique({
          where: { id: input.deviceId },
        });
        if (!existing) {
          throw error;
        }
      }
    }

    if (existing.userId !== actor.userId) {
      throw new DirectChatError(
        "FORBIDDEN",
        "Device id is already registered",
      );
    }
    if (existing.revokedAt) {
      throw new DirectChatError(
        "DEVICE_REVOKED",
        "This device was revoked",
      );
    }
    if (
      existing.identityEd25519Public !== input.identityEd25519Public ||
      existing.identityX25519Public !== input.identityX25519Public ||
      existing.signedPrekeyId !== input.signedPrekeyId ||
      existing.signedPrekeyPublic !== input.signedPrekeyPublic ||
      existing.signedPrekeySignature !== input.signedPrekeySignature
    ) {
      throw new DirectChatError(
        "TAMPERED",
        "Registered device key material cannot be replaced",
      );
    }

    const saved = await this.db.$transaction(
      async (tx) => {
        await tx.directOneTimePrekey.deleteMany({
          where: {
            deviceId: existing.id,
            consumedAt: null,
          },
        });
        if (input.oneTimePrekeys.length > 0) {
          await tx.directOneTimePrekey.createMany({
            data: input.oneTimePrekeys.map((key) => ({
              deviceId: existing.id,
              keyId: key.keyId,
              publicKey: key.publicKey,
            })),
            skipDuplicates: true,
          });
        }
        return tx.userCryptoDevice.update({
          where: { id: existing.id },
          data: {
            label: input.label ?? undefined,
          },
        });
      },
    );
    return toDeviceView(saved);
  }

  async rotate(actor: ActorContext, deviceId: string, input: RotatePrekeys): Promise<CryptoDeviceView> {
    const device = await this.requireOwnActiveDevice(actor.userId, deviceId);
    assertSignedPrekey(device.identityEd25519Public, input.signedPrekeyId, input.signedPrekeyPublic, input.signedPrekeySignature);
    const updated = await this.db.$transaction(
      async (tx) => {
        const row = await tx.userCryptoDevice.update({
          where: { id: device.id },
          data: {
            signedPrekeyId: input.signedPrekeyId,
            signedPrekeyPublic: input.signedPrekeyPublic,
            signedPrekeySignature:
              input.signedPrekeySignature,
          },
        });
        await tx.directOneTimePrekey.deleteMany({
          where: {
            deviceId: device.id,
            consumedAt: null,
          },
        });
        await tx.directOneTimePrekey.createMany({
          data: input.oneTimePrekeys.map((key) => ({
            deviceId: device.id,
            keyId: key.keyId,
            publicKey: key.publicKey,
          })),
          skipDuplicates: true,
        });
        return row;
      },
    );
    return toDeviceView(updated);
  }

  async prekeyStatus(
    actor: ActorContext,
    deviceId: string,
  ): Promise<{
    deviceId: string;
    available: number;
    availableKeyIds: number[];
    recentlyConsumedKeyIds: number[];
  }> {
    const device = await this.requireOwnActiveDevice(
      actor.userId,
      deviceId,
    );
    const [availableRows, consumedRows] =
      await Promise.all([
        this.db.directOneTimePrekey.findMany({
          where: {
            deviceId: device.id,
            consumedAt: null,
          },
          orderBy: { keyId: "asc" },
          select: { keyId: true },
        }),
        this.db.directOneTimePrekey.findMany({
          where: {
            deviceId: device.id,
            consumedAt: { not: null },
          },
          orderBy: [
            { consumedAt: "desc" },
            { keyId: "desc" },
          ],
          take:
            DIRECT_CHAT_LIMITS.consumedPrekeysRetainedMax,
          select: { keyId: true },
        }),
      ]);
    return {
      deviceId: device.id,
      available: availableRows.length,
      availableKeyIds: availableRows.map(
        (row) => row.keyId,
      ),
      recentlyConsumedKeyIds: consumedRows.map(
        (row) => row.keyId,
      ),
    };
  }

  async replenishOneTimePrekeys(
    actor: ActorContext,
    deviceId: string,
    input: ReplenishOneTimePrekeys,
  ): Promise<{
    deviceId: string;
    available: number;
    availableKeyIds: number[];
    recentlyConsumedKeyIds: number[];
  }> {
    const device = await this.requireOwnActiveDevice(
      actor.userId,
      deviceId,
    );
    const ids = input.oneTimePrekeys.map(
      (key) => key.keyId,
    );
    const requestedById = new Map(
      input.oneTimePrekeys.map((key) => [
        key.keyId,
        key.publicKey,
      ]),
    );

    await this.runSerializable(async (tx) => {
      const [existing, availableCount] =
        await Promise.all([
          tx.directOneTimePrekey.findMany({
            where: {
              deviceId: device.id,
              keyId: { in: ids },
            },
            select: {
              keyId: true,
              publicKey: true,
            },
          }),
          tx.directOneTimePrekey.count({
            where: {
              deviceId: device.id,
              consumedAt: null,
            },
          }),
        ]);

      for (const row of existing) {
        if (
          requestedById.get(row.keyId) !==
          row.publicKey
        ) {
          throw new DirectChatError(
            "TAMPERED",
            "One-time prekey id cannot be replaced",
          );
        }
      }

      const newCount = ids.length - existing.length;
      if (
        availableCount + newCount >
        DIRECT_CHAT_LIMITS.prekeysAvailableMax
      ) {
        throw new DirectChatError(
          "CONFLICT",
          "One-time prekey pool limit reached",
        );
      }

      await tx.directOneTimePrekey.createMany({
        data: input.oneTimePrekeys.map((key) => ({
          deviceId: device.id,
          keyId: key.keyId,
          publicKey: key.publicKey,
        })),
        skipDuplicates: true,
      });

      const persisted =
        await tx.directOneTimePrekey.findMany({
          where: {
            deviceId: device.id,
            keyId: { in: ids },
          },
          select: {
            keyId: true,
            publicKey: true,
          },
        });
      if (
        persisted.length !== ids.length ||
        persisted.some(
          (row) =>
            requestedById.get(row.keyId) !==
            row.publicKey,
        )
      ) {
        throw new DirectChatError(
          "TAMPERED",
          "One-time prekey id cannot be replaced",
        );
      }
    });

    return this.prekeyStatus(actor, device.id);
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

  async prekeyBundlesForUser(
    userId: string,
    deviceId?: string,
  ): Promise<PrekeyBundle[]> {
    const devices = await this.db.userCryptoDevice.findMany({
      where: {
        userId,
        revokedAt: null,
        ...(deviceId ? { id: deviceId } : {}),
      },
      orderBy: { createdAt: "asc" },
    });
    const bundles: PrekeyBundle[] = [];
    for (const device of devices) {
      const otk = await this.claimOneTimePrekey(device.id);
      if (!otk) {
        throw new DirectChatError(
          "PREKEYS_DEPLETED",
          "Recipient one-time prekeys are depleted",
        );
      }
      bundles.push({
        deviceId: device.id,
        identityEd25519Public: device.identityEd25519Public,
        identityX25519Public: device.identityX25519Public,
        signedPrekeyId: device.signedPrekeyId,
        signedPrekeyPublic: device.signedPrekeyPublic,
        signedPrekeySignature: device.signedPrekeySignature,
        oneTimePrekeyId: otk.keyId,
        oneTimePrekeyPublic: otk.publicKey,
      });
    }
    return bundles;
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

  private async createActiveDevice(
    userId: string,
    input: RegisterCryptoDevice,
  ) {
    return this.runSerializable(async (tx) => {
      const activeCount =
        await tx.userCryptoDevice.count({
          where: {
            userId,
            revokedAt: null,
          },
        });
      if (
        activeCount >=
        DIRECT_CHAT_LIMITS.activeDevicesPerUserMax
      ) {
        throw new DirectChatError(
          "CONFLICT",
          "Active crypto device limit reached",
        );
      }
      return tx.userCryptoDevice.create({
        data: {
          id: input.deviceId,
          userId,
          identityEd25519Public:
            input.identityEd25519Public,
          identityX25519Public:
            input.identityX25519Public,
          signedPrekeyId: input.signedPrekeyId,
          signedPrekeyPublic:
            input.signedPrekeyPublic,
          signedPrekeySignature:
            input.signedPrekeySignature,
          label: input.label ?? null,
          oneTimePrekeys: {
            create: input.oneTimePrekeys.map(
              (key) => ({
                keyId: key.keyId,
                publicKey: key.publicKey,
              }),
            ),
          },
        },
      });
    });
  }

  private async runSerializable<T>(
    operation: (
      tx: Prisma.TransactionClient,
    ) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.db.$transaction(
          operation,
          {
            isolationLevel:
              Prisma.TransactionIsolationLevel.Serializable,
          },
        );
      } catch (error: unknown) {
        if (
          isRetryableTransactionConflict(error) &&
          attempt < 2
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new Error(
      "Serializable Direct Chat transaction failed",
    );
  }

  private async claimOneTimePrekey(
    deviceId: string,
  ): Promise<{ keyId: number; publicKey: string } | null> {
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const candidate =
        await this.db.directOneTimePrekey.findFirst({
          where: { deviceId, consumedAt: null },
          orderBy: { keyId: "asc" },
          select: {
            id: true,
            keyId: true,
            publicKey: true,
          },
        });
      if (!candidate) {
        return null;
      }
      const claimed =
        await this.db.directOneTimePrekey.updateMany({
          where: {
            id: candidate.id,
            deviceId,
            consumedAt: null,
          },
          data: { consumedAt: new Date() },
        });
      if (claimed.count === 1) {
        return {
          keyId: candidate.keyId,
          publicKey: candidate.publicKey,
        };
      }
    }
    return null;
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

function isRetryableTransactionConflict(
  error: unknown,
): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2034"
  );
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
