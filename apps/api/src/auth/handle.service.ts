import { randomUUID } from "node:crypto";
import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { handleInputSchema, type HandleAvailabilityResponse } from "@vimla/contracts";
import { publicProfileSchema } from "@vimla/contracts/public-profiles";
import { Prisma, type PrismaClient } from "@vimla/database";
import { PrismaService } from "../persistence/prisma.service.js";

const PENDING_HANDLE_TTL_MS = 24 * 60 * 60 * 1000;

type HandleClient = PrismaClient | Prisma.TransactionClient;
type ClaimedHandle = { handle: string; status: "PENDING" | "ACTIVE" };

@Injectable()
export class HandleService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async availability(input: string): Promise<HandleAvailabilityResponse> {
    const handle = handleInputSchema.parse(input);
    await this.cleanupExpiredPending(handle);
    const existing = await this.prisma.client.handle.findUnique({
      where: { normalized: handle },
      select: { id: true },
    });
    return { handle, available: existing === null };
  }

  async claim(userId: string, input: string): Promise<ClaimedHandle> {
    const handle = handleInputSchema.parse(input);
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const account = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, emailVerified: true, name: true },
        });
        if (!account) {
          throw new ConflictException({ code: "handle_claim_failed", message: "Handle claim failed" });
        }

        const owned = await tx.handle.findUnique({
          where: { userId },
          select: { id: true, handle: true, status: true },
        });
        if (owned) {
          if (owned.handle !== handle) {
            throw new ConflictException({
              code: "handle_already_claimed",
              message: "This account already has a handle",
            });
          }
          const status = account.emailVerified ? "ACTIVE" : "PENDING";
          if (owned.status !== status) {
            await tx.handle.update({
              where: { userId },
              data: {
                status,
                reservationExpiresAt:
                  status === "PENDING" ? new Date(Date.now() + PENDING_HANDLE_TTL_MS) : null,
              },
            });
          }
          if (status === "ACTIVE") {
            await ensurePublicProfile(
              tx,
              account.id,
              owned.id,
              initialPublicDisplayName(account.name, owned.handle),
            );
          }
          return { handle, status };
        }

        await this.releaseExpiredExactHandle(tx, handle, userId);

        const status = account.emailVerified ? "ACTIVE" : "PENDING";
        const handleId = `user:${randomUUID()}`;
        await tx.handle.create({
          data: {
            id: handleId,
            handle,
            normalized: handle,
            kind: "USER",
            status,
            userId,
            reservationExpiresAt:
              status === "PENDING" ? new Date(Date.now() + PENDING_HANDLE_TTL_MS) : null,
          },
        });
        if (status === "ACTIVE") {
          await ensurePublicProfile(
            tx,
            account.id,
            handleId,
            initialPublicDisplayName(account.name, handle),
          );
        }
        return { handle, status };
      });
    } catch (error: unknown) {
      if (error instanceof ConflictException) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException({ code: "handle_unavailable", message: "Handle is unavailable" });
      }
      throw error;
    }
  }

  async readForUser(userId: string): Promise<ClaimedHandle | null> {
    const row = await this.prisma.client.handle.findUnique({
      where: { userId },
      select: { handle: true, status: true },
    });
    if (!row || (row.status !== "PENDING" && row.status !== "ACTIVE")) {
      return null;
    }
    return { handle: row.handle, status: row.status };
  }

  async activateVerified(
    userId: string,
    emailVerified: boolean,
  ): Promise<ClaimedHandle | null> {
    const handle = await this.prisma.client.handle.findUnique({
      where: { userId },
      select: { id: true, handle: true, kind: true, status: true },
    });
    if (!handle || handle.kind !== "USER" || handle.status === "RETIRED") {
      return null;
    }
    if (!emailVerified || handle.status === "ACTIVE") {
      return handle.status === "PENDING" || handle.status === "ACTIVE"
        ? { handle: handle.handle, status: handle.status }
        : null;
    }
    if (handle.status !== "PENDING") {
      return null;
    }

    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    if (!user) {
      return null;
    }

    return this.prisma.client.$transaction(async (tx) => {
      const current = await tx.handle.findUnique({
        where: { id: handle.id },
        select: { id: true, handle: true, kind: true, status: true, userId: true },
      });
      if (
        !current ||
        current.userId !== userId ||
        current.kind !== "USER" ||
        current.status === "RETIRED"
      ) {
        return null;
      }
      if (current.status === "ACTIVE") {
        return { handle: current.handle, status: "ACTIVE" };
      }
      if (current.status !== "PENDING") {
        return null;
      }

      await tx.handle.update({
        where: { id: current.id },
        data: { status: "ACTIVE", reservationExpiresAt: null },
      });
      await ensurePublicProfile(
        tx,
        userId,
        current.id,
        initialPublicDisplayName(user.name, current.handle),
      );
      return { handle: current.handle, status: "ACTIVE" };
    });
  }

  private async cleanupExpiredPending(handle: string): Promise<void> {
    await this.prisma.client.handle.deleteMany({
      where: {
        normalized: handle,
        kind: "USER",
        status: "PENDING",
        reservationExpiresAt: { lt: new Date() },
      },
    });
  }

  private async releaseExpiredExactHandle(
    client: HandleClient,
    handle: string,
    claimingUserId: string,
  ): Promise<void> {
    const row = await client.handle.findUnique({
      where: { normalized: handle },
      select: { id: true, kind: true, status: true, userId: true, reservationExpiresAt: true },
    });
    if (!row) {
      return;
    }
    const expired =
      row.kind === "USER" &&
      row.status === "PENDING" &&
      row.userId !== claimingUserId &&
      row.reservationExpiresAt !== null &&
      row.reservationExpiresAt.getTime() < Date.now();
    if (expired) {
      await client.handle.delete({ where: { id: row.id } });
      return;
    }
    throw new ConflictException({ code: "handle_unavailable", message: "Handle is unavailable" });
  }
}

async function ensurePublicProfile(
  client: HandleClient,
  userId: string,
  handleId: string,
  displayName: string,
): Promise<void> {
  const existing = await client.publicProfile.findUnique({
    where: { userId },
    select: { handleId: true },
  });
  if (existing) {
    if (existing.handleId !== handleId) {
      throw new Error("Public profile handle ownership invariant is invalid");
    }
    return;
  }

  try {
    await client.publicProfile.create({
      data: {
        userId,
        handleId,
        displayName,
      },
    });
  } catch (error: unknown) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
    const concurrent = await client.publicProfile.findUnique({
      where: { userId },
      select: { handleId: true },
    });
    if (!concurrent || concurrent.handleId !== handleId) {
      throw error;
    }
  }
}

function initialPublicDisplayName(accountName: string, handle: string): string {
  const parsed = publicProfileSchema.shape.displayName.safeParse(accountName);
  return parsed.success ? parsed.data : handle;
}
