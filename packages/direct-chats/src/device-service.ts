import type { CryptoDeviceView, PrekeyBundle, RegisterCryptoDevice, RotatePrekeys } from "@vimla/contracts";
import type { Prisma } from "@vimla/database";
import { b64ToBytes, verifySignedPreKey } from "@vimla/e2ee";
import { DirectChatError } from "./errors.js";
import { lockDirectDeviceRoster } from "./device-roster-lock.js";
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

    const saved = await this.db.$transaction(async (tx) => {
      // A row lock cannot serialize the first insert because the row does
      // not exist yet. Use a transaction-scoped advisory lock keyed by the
      // stable client-generated device id so two first registrations for
      // the same id cannot race through the identity check.
      await tx.$queryRaw<Array<{ locked: number }>>`
        WITH "device_registration_lock" AS (
          SELECT pg_advisory_xact_lock(
            hashtextextended(${input.deviceId}, 0)
          )
        )
        SELECT 1::int AS "locked"
        FROM "device_registration_lock"
      `;

      // Enrolment must serialize with Direct message fan-out. A newly
      // inserted device has no row for a sender transaction to lock.
      await lockDirectDeviceRoster(tx, [actor.userId]);

      const existing =
        await tx.userCryptoDevice.findUnique({
          where: { id: input.deviceId },
        });
      if (existing && existing.userId !== actor.userId) {
        throw new DirectChatError(
          "FORBIDDEN",
          "Device id is already registered",
        );
      }
      if (existing?.revokedAt) {
        throw new DirectChatError(
          "DEVICE_REVOKED",
          "This device was revoked",
        );
      }
      if (
        existing &&
        (existing.identityEd25519Public !==
          input.identityEd25519Public ||
          existing.identityX25519Public !==
            input.identityX25519Public)
      ) {
        throw new DirectChatError(
          "TAMPERED",
          "Device identity does not match the registered device",
        );
      }

      if (!existing) {
        return tx.userCryptoDevice.create({
          data: {
            id: input.deviceId,
            userId: actor.userId,
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
              create: input.oneTimePrekeys.map((key) => ({
                keyId: key.keyId,
                publicKey: key.publicKey,
              })),
            },
          },
        });
      }

      const updated = await tx.userCryptoDevice.update({
        where: { id: existing.id },
        data: {
          signedPrekeyId: input.signedPrekeyId,
          signedPrekeyPublic: input.signedPrekeyPublic,
          signedPrekeySignature:
            input.signedPrekeySignature,
          label: input.label ?? undefined,
        },
      });
      await tx.directOneTimePrekey.deleteMany({
        where: {
          deviceId: existing.id,
          consumedAt: null,
        },
      });
      await tx.directOneTimePrekey.createMany({
        data: input.oneTimePrekeys.map((key) => ({
          deviceId: existing.id,
          keyId: key.keyId,
          publicKey: key.publicKey,
        })),
        skipDuplicates: true,
      });
      return updated;
    });

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
    return this.db.$transaction(async (tx) => {
      // Use the same roster lock as enrolment and Direct message inserts.
      // This prevents an externally observed device-set mutation from
      // splitting a signed multi-recipient send transaction.
      await lockDirectDeviceRoster(tx, [actor.userId]);
      const device = await tx.userCryptoDevice.findFirst({
        where: { id: deviceId, userId: actor.userId },
      });
      if (!device) {
        throw new DirectChatError("NOT_FOUND", "Device was not found");
      }
      if (device.revokedAt) {
        return toDeviceView(device);
      }
      const updated = await tx.userCryptoDevice.update({
        where: { id: device.id },
        data: { revokedAt: new Date() },
      });
      return toDeviceView(updated);
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


type PrekeyDb = Pick<
  Prisma.TransactionClient,
  "$queryRaw" | "userCryptoDevice" | "directOneTimePrekey"
>;

export async function consumePrekeyBundlesForUser(
  db: PrekeyDb,
  userId: string,
): Promise<PrekeyBundle[]> {
  const devices = await db.userCryptoDevice.findMany({
    where: { userId, revokedAt: null },
    orderBy: { id: "asc" },
  });
  const bundles: PrekeyBundle[] = [];
  for (const device of devices) {
    // Concurrent requesters must never claim the same OTK. The selected row
    // stays locked until the surrounding transaction commits.
    const available = await db.$queryRaw<
      Array<{ id: string; keyId: number; publicKey: string }>
    >`
      SELECT "id", "keyId", "publicKey"
      FROM "direct_one_time_prekey"
      WHERE "deviceId" = ${device.id} AND "consumedAt" IS NULL
      ORDER BY "keyId" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    const otk = available[0];
    if (otk) {
      await db.directOneTimePrekey.update({
        where: { id: otk.id },
        data: { consumedAt: new Date() },
      });
    }
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
}
