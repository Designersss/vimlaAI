import type { PrismaClient } from "@vimla/database";
import {
  ADMIN_COOKIE_NAME,
  OWNER_PERMISSIONS,
  OWNER_ROLE_CODE,
  type AdminPermission,
} from "./permissions.js";
import {
  generateAdminToken,
  hashAdminToken,
  hashIp,
  sanitizeAuditSnapshot,
  serializeCookie,
  summarizeUserAgent,
} from "./security.js";

export interface AdminActor {
  userId: string;
  principalId: string;
  sessionId: string;
  permissions: readonly AdminPermission[];
  lastStrongAuthAt: Date;
  email: string;
}

export interface AdminSessionConfig {
  secret: string;
  ttlSeconds: number;
  idleSeconds: number;
  stepUpSeconds: number;
  requireTotp: boolean;
  requirePasskey: boolean;
  cookieSecure: boolean;
}

export class AdminControlService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AdminSessionConfig,
  ) {}

  async bootstrapOwner(userId: string, actorUserId?: string): Promise<{ principalId: string; created: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error("User was not found");
    }
    if (!user.emailVerified) {
      throw new Error("Owner bootstrap requires a verified email");
    }

    const role = await this.prisma.adminRole.upsert({
      where: { code: OWNER_ROLE_CODE },
      update: { permissions: [...OWNER_PERMISSIONS] },
      create: { code: OWNER_ROLE_CODE, permissions: [...OWNER_PERMISSIONS] },
    });

    const existing = await this.prisma.adminPrincipal.findUnique({
      where: { userId },
      include: { roles: true },
    });
    if (existing) {
      if (existing.status !== "ACTIVE") {
        await this.prisma.adminPrincipal.update({
          where: { id: existing.id },
          data: { status: "ACTIVE", disabledAt: null },
        });
      }
      if (!existing.roles.some((item) => item.roleId === role.id)) {
        await this.prisma.adminPrincipalRole.create({
          data: { principalId: existing.id, roleId: role.id },
        });
      }
      await this.audit({
        adminUserId: actorUserId ?? userId,
        principalId: existing.id,
        action: "ADMIN_BOOTSTRAP",
        resourceType: "AdminPrincipal",
        resourceId: existing.id,
        afterSnapshot: { userId, status: "ACTIVE", idempotent: true },
      });
      return { principalId: existing.id, created: false };
    }

    const principal = await this.prisma.adminPrincipal.create({
      data: {
        userId,
        status: "ACTIVE",
        createdByUserId: actorUserId ?? null,
        roles: { create: { roleId: role.id } },
      },
    });
    await this.audit({
      adminUserId: actorUserId ?? userId,
      principalId: principal.id,
      action: "ADMIN_BOOTSTRAP",
      resourceType: "AdminPrincipal",
      resourceId: principal.id,
      afterSnapshot: { userId, status: "ACTIVE", role: OWNER_ROLE_CODE },
    });
    return { principalId: principal.id, created: true };
  }

  async disablePrincipal(userId: string, actorUserId?: string): Promise<void> {
    const principal = await this.prisma.adminPrincipal.findUnique({ where: { userId } });
    if (!principal) {
      throw new Error("Admin principal was not found");
    }
    const now = new Date();
    await this.prisma.adminPrincipal.update({
      where: { id: principal.id },
      data: { status: "DISABLED", disabledAt: now },
    });
    await this.revokeSessions(userId);
    await this.audit({
      adminUserId: actorUserId ?? userId,
      principalId: principal.id,
      action: "ADMIN_DISABLED",
      resourceType: "AdminPrincipal",
      resourceId: principal.id,
      afterSnapshot: { userId, status: "DISABLED" },
    });
  }

  async revokeSessions(userId: string, actorUserId?: string): Promise<number> {
    const principal = await this.prisma.adminPrincipal.findUnique({ where: { userId } });
    if (!principal) {
      return 0;
    }
    const result = await this.prisma.adminSession.updateMany({
      where: { principalId: principal.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit({
      adminUserId: actorUserId ?? userId,
      principalId: principal.id,
      action: "ADMIN_SESSION_REVOKED",
      resourceType: "AdminSession",
      resourceId: principal.id,
      afterSnapshot: { count: result.count },
    });
    return result.count;
  }

  async createSession(input: {
    userId: string;
    ip?: string;
    userAgent?: string;
  }): Promise<{ token: string; cookie: string; sessionId: string }> {
    const principal = await this.loadActivePrincipal(input.userId);
    const token = generateAdminToken();
    const now = new Date();
    const session = await this.prisma.adminSession.create({
      data: {
        principalId: principal.id,
        tokenHash: hashAdminToken(token, this.config.secret),
        expiresAt: new Date(now.getTime() + this.config.ttlSeconds * 1000),
        idleExpiresAt: new Date(now.getTime() + this.config.idleSeconds * 1000),
        lastStrongAuthAt: now,
        lastSeenAt: now,
        userAgentSummary: summarizeUserAgent(input.userAgent),
        ipHash: input.ip ? hashIp(input.ip, this.config.secret) : null,
      },
    });
    return {
      token,
      sessionId: session.id,
      cookie: serializeCookie(ADMIN_COOKIE_NAME, token, {
        maxAgeSeconds: this.config.ttlSeconds,
        secure: this.config.cookieSecure,
      }),
    };
  }

  async resolveSession(token: string | null): Promise<AdminActor | null> {
    if (!token) {
      return null;
    }
    const tokenHash = hashAdminToken(token, this.config.secret);
    const session = await this.prisma.adminSession.findUnique({
      where: { tokenHash },
      include: {
        principal: {
          include: {
            user: { select: { id: true, email: true, emailVerified: true, twoFactorEnabled: true } },
            roles: { include: { role: true } },
          },
        },
      },
    });
    if (!session || session.revokedAt) {
      return null;
    }
    const now = new Date();
    if (session.expiresAt <= now || session.idleExpiresAt <= now) {
      return null;
    }
    if (session.principal.status !== "ACTIVE" || session.principal.disabledAt) {
      return null;
    }
    if (!session.principal.user.emailVerified) {
      return null;
    }
    await this.prisma.adminSession.update({
      where: { id: session.id },
      data: {
        lastSeenAt: now,
        idleExpiresAt: new Date(now.getTime() + this.config.idleSeconds * 1000),
      },
    });
    const permissions = [
      ...new Set(session.principal.roles.flatMap((item) => item.role.permissions)),
    ] as AdminPermission[];
    return {
      userId: session.principal.userId,
      principalId: session.principal.id,
      sessionId: session.id,
      permissions,
      lastStrongAuthAt: session.lastStrongAuthAt,
      email: session.principal.user.email,
    };
  }

  hasFreshStepUp(actor: AdminActor, now = new Date()): boolean {
    return now.getTime() - actor.lastStrongAuthAt.getTime() <= this.config.stepUpSeconds * 1000;
  }

  async markStrongAuth(sessionId: string): Promise<void> {
    const now = new Date();
    await this.prisma.adminSession.update({
      where: { id: sessionId },
      data: {
        lastStrongAuthAt: now,
        lastSeenAt: now,
        idleExpiresAt: new Date(now.getTime() + this.config.idleSeconds * 1000),
      },
    });
  }

  async revokeSessionById(sessionId: string, adminUserId: string): Promise<void> {
    await this.prisma.adminSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
    await this.audit({
      adminUserId,
      adminSessionId: sessionId,
      action: "ADMIN_SESSION_REVOKED",
      resourceType: "AdminSession",
      resourceId: sessionId,
    });
  }

  logoutCookie(): string {
    return serializeCookie(ADMIN_COOKIE_NAME, "", {
      maxAgeSeconds: 0,
      secure: this.config.cookieSecure,
    });
  }

  async audit(input: {
    adminUserId: string;
    principalId?: string | null;
    adminSessionId?: string | null;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    requestId?: string | null;
    ipHash?: string | null;
    userAgentSummary?: string | null;
    beforeSnapshot?: unknown;
    afterSnapshot?: unknown;
    reason?: string | null;
  }): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId: input.adminUserId,
        principalId: input.principalId ?? null,
        adminSessionId: input.adminSessionId ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        requestId: input.requestId ?? null,
        ipHash: input.ipHash ?? null,
        userAgentSummary: input.userAgentSummary ?? null,
        beforeSnapshot: input.beforeSnapshot
          ? (sanitizeAuditSnapshot(input.beforeSnapshot) as object)
          : undefined,
        afterSnapshot: input.afterSnapshot
          ? (sanitizeAuditSnapshot(input.afterSnapshot) as object)
          : undefined,
        reason: input.reason ?? null,
      },
    });
  }

  async recordSecurityEvent(input: {
    kind: string;
    userId?: string | null;
    ip?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.adminSecurityEvent.create({
      data: {
        kind: input.kind,
        userId: input.userId ?? null,
        ipHash: input.ip ? hashIp(input.ip, this.config.secret) : null,
        metadata: input.metadata ? (sanitizeAuditSnapshot(input.metadata) as object) : undefined,
      },
    });
  }

  async loadActivePrincipal(userId: string) {
    const principal = await this.prisma.adminPrincipal.findUnique({
      where: { userId },
      include: {
        user: true,
        roles: { include: { role: true } },
      },
    });
    if (!principal || principal.status !== "ACTIVE" || principal.disabledAt) {
      throw new Error("Admin principal is not active");
    }
    return principal;
  }
}

export const AI_TEXT_DISABLED_SETTING = "ai_text_disabled";

export async function isAiTextOperatorDisabled(prisma: PrismaClient): Promise<boolean> {
  const row = await prisma.operatorSetting.findUnique({
    where: { key: AI_TEXT_DISABLED_SETTING },
  });
  if (!row) {
    return false;
  }
  if (row.valueJson === true) {
    return true;
  }
  if (row.valueJson !== null && typeof row.valueJson === "object" && "disabled" in row.valueJson) {
    return (row.valueJson as { disabled?: unknown }).disabled === true;
  }
  return false;
}
