import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CLIENT_INSTALLATION_LIMITS,
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
      return this.refreshOwned(userId, existing, input);
    }

    const activeCount =
      await this.prisma.client.clientInstallation.count({
        where: { userId, revokedAt: null },
      });
    if (
      activeCount >=
      CLIENT_INSTALLATION_LIMITS.activePerUserMax
    ) {
      throw new ConflictException({
        code: "installation_limit_reached",
        message: "Active installation limit reached",
      });
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
      return this.refreshOwned(userId, raced, input);
    }
  }

  async list(userId: string): Promise<ClientInstallationView[]> {
    const rows =
      await this.prisma.client.clientInstallation.findMany({
        where: { userId },
        include: { preference: true },
        orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
      });
    return rows.map((row) => this.view(row));
  }

  async revoke(
    userId: string,
    installationId: string,
  ): Promise<ClientInstallationView> {
    const row = await this.owned(userId, installationId);
    if (row.revokedAt) {
      return this.view(row);
    }
    const updated =
      await this.prisma.client.clientInstallation.update({
        where: { id: installationId },
        data: { revokedAt: new Date() },
        include: { preference: true },
      });
    return this.view(updated);
  }

  async updatePreferences(
    userId: string,
    installationId: string,
    input: UpdateClientInstallationPreferences,
  ): Promise<ClientInstallationView> {
    const row = await this.owned(userId, installationId);
    if (row.revokedAt) {
      throw new ConflictException({
        code: "installation_revoked",
        message: "Client installation is revoked",
      });
    }
    await this.prisma.client.clientInstallationPreference.upsert({
      where: { installationId },
      create: {
        installationId,
        pushEnabled: input.pushEnabled ?? true,
      },
      update: {
        ...(input.pushEnabled !== undefined
          ? { pushEnabled: input.pushEnabled }
          : {}),
      },
    });
    const updated =
      await this.prisma.client.clientInstallation.findUniqueOrThrow({
        where: { id: installationId },
        include: { preference: true },
      });
    return this.view(updated);
  }

  private async refreshOwned(
    userId: string,
    row: InstallationRow,
    input: RegisterClientInstallation,
  ): Promise<ClientInstallationView> {
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
      return this.view(row);
    }

    const updated =
      await this.prisma.client.clientInstallation.update({
        where: { id: row.id },
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
    return this.view(updated);
  }

  private async owned(
    userId: string,
    installationId: string,
  ): Promise<InstallationRow> {
    const row =
      await this.prisma.client.clientInstallation.findFirst({
        where: { id: installationId, userId },
        include: { preference: true },
      });
    if (!row) {
      throw notFound();
    }
    return row;
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
        pushEnabled: row.preference?.pushEnabled ?? true,
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
