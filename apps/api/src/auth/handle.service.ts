import { randomUUID } from "node:crypto";
import { ConflictException, Injectable } from "@nestjs/common";
import { handleInputSchema, type HandleAvailabilityResponse } from "@vimla/contracts";
import { Prisma, type PrismaClient } from "@vimla/database";
import { PrismaService } from "../persistence/prisma.service.js";

const PENDING_HANDLE_TTL_MS = 24 * 60 * 60 * 1000;

type HandleClient = PrismaClient | Prisma.TransactionClient;
type ClaimedHandle = { handle: string; status: "PENDING" | "ACTIVE" };

@Injectable()
export class HandleService {
  constructor(private readonly prisma: PrismaService) {}

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
          select: { id: true, emailVerified: true },
        });
        if (!account) {
          throw new ConflictException({ code: "handle_claim_failed", message: "Handle claim failed" });
        }

        const owned = await tx.handle.findUnique({
          where: { userId },
          select: { handle: true, status: true },
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
          return { handle, status };
        }

        await this.releaseExpiredExactHandle(tx, handle, userId);

        const status = account.emailVerified ? "ACTIVE" : "PENDING";
        await tx.handle.create({
          data: {
            id: `user:${randomUUID()}`,
            handle,
            normalized: handle,
            kind: "USER",
            status,
            userId,
            reservationExpiresAt:
              status === "PENDING" ? new Date(Date.now() + PENDING_HANDLE_TTL_MS) : null,
          },
        });
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

  async activateVerified(userId: string): Promise<void> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { emailVerified: true },
    });
    if (!user?.emailVerified) {
      return;
    }
    await this.prisma.client.handle.updateMany({
      where: { userId, kind: "USER", status: "PENDING" },
      data: { status: "ACTIVE", reservationExpiresAt: null },
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
