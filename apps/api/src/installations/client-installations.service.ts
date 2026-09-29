import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  clientInstallationViewSchema,
  type ClientInstallationView,
  type RegisterClientInstallation,
  type UpdateClientInstallationPreferences,
} from "@vimla/contracts";
import { Prisma } from "@vimla/database";
import { PrismaService } from "../persistence/prisma.service.js";

const LAST_SEEN_REFRESH_MS = 5 * 60 * 1000;

type InstallationRow = Prisma.ClientInstallationGetPayload<{
  include: { preference: true };
}>;

@Injectable()
export class ClientInstallationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async register(
    userId: string,
    input: RegisterClientInstallation,
  ): Promise<ClientInstallationView> {
    const existing =
      await this.prisma.client.clientInstallation.findUnique({
        where: { id: input.id },
        include: { preference: true },
      });
    if (existing) {
      return this.view(
        await this.refreshOwned(
          userId,
          existing,
          input,
        ),
      );
    }

    try {
      const created =
        await this.prisma.client.clientInstallation.create({
          data: {
            id: input.id,
            userId,
            kind: input.kind,
            appVersion: input.appVersion,
            protocolVersion: input.protocolVersion,
            capabilities: input.capabilities,
            preference: { create: {} },
          },
          include: { preference: true },
        });
      return this.view(created);
    } catch (error: unknown) {
      if (!isUniqueConflict(error)) {
        throw error;
      }
      const raced =
        await this.prisma.client.clientInstallation.findUnique({
          where: { id: input.id },
          include: { preference: true },
        });
      if (!raced) {
        throw error;
      }
      return this.view(
        await this.refreshOwned(
          userId,
          raced,
          input,
        ),
      );
    }
  }

  async revoke(
    userId: string,
    installationId: string,
  ): Promise<ClientInstallationView> {
    const now = new Date();
    await this.prisma.client.clientInstallation.updateMany({
      where: {
        id: installationId,
        userId,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
    const row =
      await this.prisma.client.clientInstallation.findFirst({
        where: { id: installationId, userId },
        include: { preference: true },
      });
    if (!row) {
      throw notFound();
    }
    return this.view(row);
  }

  async updatePreferences(
    userId: string,
    installationId: string,
    input: UpdateClientInstallationPreferences,
  ): Promise<ClientInstallationView> {
    return this.prisma.client.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ id: string; revokedAt: Date | null }>
      >(Prisma.sql`
        SELECT "id", "revokedAt"
        FROM "client_installation"
        WHERE "id" = ${installationId}
          AND "userId" = ${userId}
        FOR UPDATE
      `);
      const row = locked[0];
      if (!row) {
        throw notFound();
      }
      if (row.revokedAt) {
        throw new ConflictException({
          code: "installation_revoked",
          message: "Client installation is revoked",
        });
      }

      await tx.clientInstallationPreference.upsert({
        where: { installationId },
        create: {
          installationId,
          pushEnabled: input.pushEnabled ?? false,
        },
        update: {
          ...(input.pushEnabled !== undefined
            ? { pushEnabled: input.pushEnabled }
            : {}),
        },
      });
      const updated =
        await tx.clientInstallation.findUniqueOrThrow({
          where: { id: installationId },
          include: { preference: true },
        });
      return this.view(updated);
    });
  }

  private async refreshOwned(
    userId: string,
    row: InstallationRow,
    input: RegisterClientInstallation,
  ): Promise<InstallationRow> {
    if (row.userId !== userId) {
      throw notFound();
    }
    if (row.revokedAt) {
      throw new ConflictException({
        code: "installation_revoked",
        message: "Client installation is revoked",
      });
    }

    const metadataChanged =
      row.kind !== input.kind ||
      row.appVersion !== input.appVersion ||
      row.protocolVersion !== input.protocolVersion ||
      !sameStrings(row.capabilities, input.capabilities);
    const refreshLastSeen =
      row.lastSeenAt.getTime() <=
      Date.now() - LAST_SEEN_REFRESH_MS;

    if (!metadataChanged && !refreshLastSeen && row.preference) {
      return row;
    }

    try {
      return await this.prisma.client.clientInstallation.update({
        where: { id: row.id, userId, revokedAt: null },
        data: {
          ...(metadataChanged
            ? {
                kind: input.kind,
                appVersion: input.appVersion,
                protocolVersion: input.protocolVersion,
                capabilities: input.capabilities,
              }
            : {}),
          ...(refreshLastSeen ? { lastSeenAt: new Date() } : {}),
          ...(!row.preference
            ? { preference: { create: {} } }
            : {}),
        },
        include: { preference: true },
      });
    } catch (error: unknown) {
      if (!isRecordMissing(error)) {
        throw error;
      }
      const current =
        await this.prisma.client.clientInstallation.findUnique({
          where: { id: row.id },
        });
      if (current?.userId === userId && current.revokedAt) {
        throw new ConflictException({
          code: "installation_revoked",
          message: "Client installation is revoked",
        });
      }
      throw notFound();
    }
  }

  private view(row: InstallationRow): ClientInstallationView {
    return clientInstallationViewSchema.parse({
      id: row.id,
      kind: row.kind,
      appVersion: row.appVersion,
      protocolVersion: row.protocolVersion,
      capabilities: row.capabilities,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      preferences: {
        pushEnabled: row.preference?.pushEnabled ?? false,
      },
    });
  }
}

function notFound(): NotFoundException {
  return new NotFoundException({
    code: "not_found",
    message: "Client installation not found",
  });
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isUniqueConflict(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}


function isRecordMissing(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  );
}
