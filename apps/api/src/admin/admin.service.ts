import { ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  AI_TEXT_DISABLED_SETTING,
  hashIp,
  isAiTextOperatorDisabled,
  summarizeUserAgent,
  type AdminActor,
  type AdminControlService,
} from "@vimla/admin";
import { AUTH_BASE_PATH, type VimlaAuth } from "@vimla/auth";
import {
  microRubFromJson,
  type DraftPlanInput,
  type FinanceQueryFilter,
  type FinanceQueryService,
  type PolicyAdminService,
  type PublishConfirmation,
  type TariffAdminService,
  type TariffSimulationAssumptions,
} from "@vimla/billing";
import { PrismaService } from "../persistence/prisma.service.js";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { VIMLA_AUTH } from "../auth/auth.tokens.js";
import { ADMIN_CONTROL, ADMIN_FINANCE, ADMIN_POLICY, ADMIN_TARIFF } from "./admin.tokens.js";

@Injectable()
export class AdminFacade {
  constructor(
    @Inject(ADMIN_CONTROL) readonly control: AdminControlService,
    @Inject(ADMIN_TARIFF) readonly tariffs: TariffAdminService,
    @Inject(ADMIN_POLICY) readonly policies: PolicyAdminService,
    @Inject(ADMIN_FINANCE) readonly finance: FinanceQueryService,
    @Inject(PrismaService) private readonly prismaService: PrismaService,
    @Inject(API_CONFIG) private readonly config: ApiRuntimeConfig,
    @Inject(VIMLA_AUTH) private readonly auth: VimlaAuth,
  ) {}

  clientIp(request: FastifyRequest): string {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
      return forwarded.split(",")[0]?.trim() ?? "unknown";
    }
    return request.ip ?? "unknown";
  }

  async elevate(
    request: FastifyRequest,
    reply: FastifyReply,
    body: { totpCode?: string; backupCode?: string },
  ) {
    const session = await this.auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!session || session.user.emailVerified !== true) {
      throw new UnauthorizedException("Verified identity is required");
    }
    const ip = this.clientIp(request);
    try {
      const principal = await this.control.loadActivePrincipal(session.user.id).catch(() => {
        throw new ForbiddenException("Admin principal is not active");
      });
      const user = await this.prismaService.client.user.findUniqueOrThrow({
        where: { id: session.user.id },
        include: { twoFactor: true, passkeys: { select: { id: true } } },
      });
      if (this.config.adminRequireTotp && user.twoFactorEnabled !== true) {
        throw new ForbiddenException("TOTP enrollment is required for Admin");
      }
      if (this.config.adminRequirePasskey && user.passkeys.length < 1) {
        throw new ForbiddenException("A passkey is required for Admin");
      }
      await this.verifyStrongFactor(request, body);
      const created = await this.control.createSession({
        userId: principal.userId,
        ip,
        userAgent: request.headers["user-agent"],
      });
      void reply.header("set-cookie", created.cookie);
      await this.control.audit({
        adminUserId: principal.userId,
        principalId: principal.id,
        adminSessionId: created.sessionId,
        action: "ADMIN_LOGIN_SUCCESS",
        resourceType: "AdminSession",
        resourceId: created.sessionId,
        requestId: String(request.id),
        ipHash: hashIp(ip, this.config.betterAuthSecret),
        userAgentSummary: summarizeUserAgent(request.headers["user-agent"]),
      });
      await this.control.recordSecurityEvent({
        kind: "ADMIN_LOGIN_SUCCESS",
        userId: principal.userId,
        ip,
      });
      return { ok: true, sessionId: created.sessionId };
    } catch (error) {
      await this.control.recordSecurityEvent({
        kind: "ADMIN_LOGIN_FAILURE",
        userId: session.user.id,
        ip,
        metadata: { reason: error instanceof Error ? error.message : "unknown" },
      });
      await this.control.audit({
        adminUserId: session.user.id,
        action: "ADMIN_LOGIN_FAILURE",
        resourceType: "AdminSession",
        requestId: String(request.id),
        ipHash: hashIp(ip, this.config.betterAuthSecret),
        userAgentSummary: summarizeUserAgent(request.headers["user-agent"]),
      });
      throw error;
    }
  }

  async verifyStrongFactor(
    request: FastifyRequest,
    body: { totpCode?: string; backupCode?: string },
  ): Promise<void> {
    const headers = fromNodeHeaders(request.headers);
    if (body.totpCode) {
      await this.callBetterAuth("/two-factor/verify-totp", headers, { code: body.totpCode });
      return;
    }
    if (body.backupCode) {
      await this.callBetterAuth("/two-factor/verify-backup-code", headers, { code: body.backupCode });
      return;
    }
    throw new ForbiddenException("TOTP or backup code is required");
  }

  private async callBetterAuth(
    path: string,
    headers: Headers,
    body: Record<string, string>,
  ): Promise<void> {
    const requestHeaders = new Headers(headers);
    requestHeaders.set("content-type", "application/json");
    const response = await this.auth.handler(
      new Request(`${this.config.betterAuthUrl}${AUTH_BASE_PATH}${path}`, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(body),
      }),
    );
    if (!response.ok) {
      throw new ForbiddenException("Strong authentication failed");
    }
  }

  async logout(actor: AdminActor, reply: FastifyReply) {
    await this.control.revokeSessionById(actor.sessionId, actor.userId);
    void reply.header("set-cookie", this.control.logoutCookie());
    return { ok: true };
  }

  async current(actor: AdminActor) {
    return {
      userId: actor.userId,
      email: actor.email,
      principalId: actor.principalId,
      permissions: actor.permissions,
      lastStrongAuthAt: actor.lastStrongAuthAt.toISOString(),
    };
  }

  parseRange(query: Record<string, unknown>): FinanceQueryFilter {
    const from = typeof query.from === "string" ? new Date(query.from) : undefined;
    const to = typeof query.to === "string" ? new Date(query.to) : undefined;
    if (from && Number.isNaN(from.getTime())) {
      throw new ForbiddenException("Invalid from date");
    }
    if (to && Number.isNaN(to.getTime())) {
      throw new ForbiddenException("Invalid to date");
    }
    if (from && to) {
      const maxMs = this.config.adminQueryMaxRangeDays * 24 * 60 * 60 * 1000;
      if (to.getTime() - from.getTime() > maxMs) {
        throw new ForbiddenException("Date range exceeds the configured maximum");
      }
    }
    return {
      from,
      to,
      planVersionId: typeof query.planVersionId === "string" ? query.planVersionId : undefined,
      paymentKind:
        query.paymentKind === "SUBSCRIPTION" || query.paymentKind === "TOPUP"
          ? query.paymentKind
          : undefined,
    };
  }

  reportingTimezone(query: Record<string, unknown>): string {
    const value =
      typeof query.timezone === "string" ? query.timezone : this.config.adminReportingTimezone;
    if (!Intl.supportedValuesOf("timeZone").includes(value)) {
      throw new ForbiddenException("Invalid reporting timezone");
    }
    return value;
  }

  async setAiKillSwitch(actor: AdminActor, disabled: boolean, reason: string, requestId: string) {
    const before = await isAiTextOperatorDisabled(this.prismaService.client);
    await this.prismaService.client.operatorSetting.upsert({
      where: { key: AI_TEXT_DISABLED_SETTING },
      update: { valueJson: { disabled }, updatedByUserId: actor.userId },
      create: { key: AI_TEXT_DISABLED_SETTING, valueJson: { disabled }, updatedByUserId: actor.userId },
    });
    await this.control.audit({
      adminUserId: actor.userId,
      principalId: actor.principalId,
      adminSessionId: actor.sessionId,
      action: "AI_KILL_SWITCH_CHANGED",
      resourceType: "OperatorSetting",
      resourceId: AI_TEXT_DISABLED_SETTING,
      requestId,
      reason,
      beforeSnapshot: { disabled: before },
      afterSnapshot: { disabled },
    });
    return { envEnabled: this.config.aiTextEnabled, operatorDisabled: disabled };
  }

  async publishPlan(
    actor: AdminActor,
    planVersionId: string,
    confirmation: PublishConfirmation | null,
    requestId: string,
  ) {
    const version = await this.tariffs.simulatePlanVersion(planVersionId, await this.simulationAssumptions());
    const guardrail = await this.policies.publishedGuardrail();
    const published = await this.tariffs.publishPlanVersion(planVersionId, confirmation, {
      targetMinimumMarginBps: guardrail?.targetMinimumMarginBps ?? 0,
      worstCaseMarginBps: version.worstCase?.conservativeMarginBps ?? null,
    });
    await this.control.audit({
      adminUserId: actor.userId,
      principalId: actor.principalId,
      adminSessionId: actor.sessionId,
      action: "PLAN_PUBLISHED",
      resourceType: "PlanVersion",
      resourceId: published.id,
      requestId,
      reason: confirmation?.reason ?? null,
      afterSnapshot: { planCode: published.planCode, status: published.status },
    });
    return published;
  }

  async updateDraft(
    actor: AdminActor,
    planVersionId: string,
    input: Omit<DraftPlanInput, "planId">,
    requestId: string,
  ) {
    const updated = await this.tariffs.updatePlanDraft(planVersionId, input);
    await this.control.audit({
      adminUserId: actor.userId,
      principalId: actor.principalId,
      adminSessionId: actor.sessionId,
      action: "PLAN_DRAFT_UPDATED",
      resourceType: "PlanVersion",
      resourceId: updated.id,
      requestId,
      afterSnapshot: { planCode: updated.planCode },
    });
    return updated;
  }

  async retirePlan(actor: AdminActor, planVersionId: string, requestId: string) {
    const retired = await this.tariffs.retirePlanVersion(planVersionId);
    await this.control.audit({
      adminUserId: actor.userId,
      principalId: actor.principalId,
      adminSessionId: actor.sessionId,
      action: "PLAN_RETIRED",
      resourceType: "PlanVersion",
      resourceId: retired.id,
      requestId,
      afterSnapshot: { status: retired.status },
    });
    return retired;
  }

  async createDraft(actor: AdminActor, input: DraftPlanInput, requestId: string) {
    const created = await this.tariffs.createPlanDraft(input, actor.userId);
    await this.control.audit({
      adminUserId: actor.userId,
      principalId: actor.principalId,
      adminSessionId: actor.sessionId,
      action: "PLAN_DRAFT_CREATED",
      resourceType: "PlanVersion",
      resourceId: created.id,
      requestId,
      afterSnapshot: { planCode: created.planCode },
    });
    return created;
  }

  money(value: string): bigint {
    return microRubFromJson(value);
  }

  async simulationAssumptions(): Promise<
    Omit<TariffSimulationAssumptions, "priceMicroRub" | "monthlyUsageGrantMicroRub">
  > {
    const fees = await this.policies.publishedFeePolicies();
    const fiscal = await this.policies.publishedFiscalization();
    const tax = await this.policies.publishedTaxReserve();
    const paymentFees: TariffSimulationAssumptions["paymentFees"] = {};
    for (const fee of fees) {
      if (
        fee.paymentMethod === "CARD" ||
        fee.paymentMethod === "SBP" ||
        fee.paymentMethod === "T_PAY" ||
        fee.paymentMethod === "OTHER"
      ) {
        paymentFees[fee.paymentMethod] = {
          feeBps: BigInt(fee.feeBps),
          feeVatBps: BigInt(fee.feeVatBps),
          minimumFeeMicroRub: fee.minimumFeeMicroRub,
          fixedFeeMicroRub: fee.fixedFeeMicroRub,
        };
      }
    }
    return {
      paymentFees,
      fiscalization: fiscal
        ? {
            percentageBps: fiscal.percentageBps === null ? null : BigInt(fiscal.percentageBps),
            fixedFeeMicroRub: fiscal.fixedFeeMicroRub,
          }
        : undefined,
      taxReserveBps: tax?.enabled ? BigInt(tax.reserveBps) : undefined,
      targetMinimumMarginBps: (await this.policies.publishedGuardrail())?.targetMinimumMarginBps,
    };
  }

  secretsStatus() {
    return {
      proxyapi: Boolean(this.config.proxyapiApiKey),
      tbank:
        this.config.tbankPassword.length > 0 && this.config.tbankTerminalKey !== "MockTerminalKey",
      smtp: this.config.emailProvider === "smtp",
    };
  }

  async reconciliationQueue() {
    const prisma = this.prismaService.client;
    const missingEconomics = await prisma.payment.findMany({
      where: {
        status: { in: ["SUCCEEDED", "REFUNDED", "PARTIALLY_REFUNDED"] },
        economics: null,
      },
      select: { id: true, status: true, kind: true, amountMicroRub: true, createdAt: true },
      take: 100,
      orderBy: { createdAt: "desc" },
    });
    const flagged = await prisma.paymentEconomics.findMany({
      where: {
        OR: [
          { economicsStatus: "RECONCILIATION_REQUIRED" },
          { paymentMethod: "UNKNOWN" },
          { paymentFeePolicyVersionId: null },
        ],
      },
      select: {
        paymentId: true,
        economicsStatus: true,
        paymentMethod: true,
        paymentFeePolicyVersionId: true,
      },
      take: 100,
    });
    return {
      missingEconomics: missingEconomics.map((row) => ({
        ...row,
        amountMicroRub: row.amountMicroRub.toString(),
        createdAt: row.createdAt.toISOString(),
      })),
      flagged,
      note: "Phase 5 is inspect-only. Manual ledger edits are forbidden.",
    };
  }

  async listUsers(query: Record<string, unknown>) {
    const take = boundLimit(query.limit);
    const skip = boundOffset(query.offset);
    const where = {
      ...(typeof query.userId === "string" ? { id: query.userId } : {}),
      ...(typeof query.email === "string"
        ? { email: { contains: query.email, mode: "insensitive" as const } }
        : {}),
      ...(query.emailVerified === "true" ? { emailVerified: true } : {}),
      ...(query.emailVerified === "false" ? { emailVerified: false } : {}),
    };
    const [items, total] = await this.prismaService.client.$transaction([
      this.prismaService.client.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          emailVerified: true,
          createdAt: true,
          twoFactorEnabled: true,
        },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      this.prismaService.client.user.count({ where }),
    ]);
    return { items, total, take, skip };
  }

  async getUser(userId: string) {
    const user = await this.prismaService.client.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        createdAt: true,
        twoFactorEnabled: true,
        sessions: { select: { id: true, createdAt: true, expiresAt: true }, take: 20, orderBy: { createdAt: "desc" } },
        subscriptions: {
          select: { id: true, status: true, periodEnd: true, planVersionId: true },
          take: 20,
        },
        usageBuckets: {
          select: { id: true, type: true, totalMicroRub: true, spentMicroRub: true, expiresAt: true },
        },
        payments: {
          select: { id: true, status: true, kind: true, amountMicroRub: true, createdAt: true },
          take: 20,
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!user) {
      return null;
    }
    return {
      ...user,
      usageBuckets: user.usageBuckets.map((bucket) => ({
        ...bucket,
        totalMicroRub: bucket.totalMicroRub.toString(),
        spentMicroRub: bucket.spentMicroRub.toString(),
        expiresAt: bucket.expiresAt?.toISOString() ?? null,
      })),
      payments: user.payments.map((payment) => ({
        ...payment,
        amountMicroRub: payment.amountMicroRub.toString(),
        createdAt: payment.createdAt.toISOString(),
      })),
    };
  }

  async listPayments(query: Record<string, unknown>) {
    const take = boundLimit(query.limit);
    const skip = boundOffset(query.offset);
    const paymentMethod =
      query.paymentMethod === "CARD" ||
      query.paymentMethod === "SBP" ||
      query.paymentMethod === "T_PAY" ||
      query.paymentMethod === "OTHER" ||
      query.paymentMethod === "UNKNOWN"
        ? query.paymentMethod
        : undefined;
    const from = typeof query.from === "string" ? new Date(query.from) : undefined;
    const to = typeof query.to === "string" ? new Date(query.to) : undefined;
    const economicsFilter = {
      ...(paymentMethod ? { paymentMethod } : {}),
      ...(typeof query.reconciliationStatus === "string"
        ? { economicsStatus: query.reconciliationStatus }
        : {}),
    };
    const where = {
      ...(typeof query.paymentId === "string" ? { id: query.paymentId } : {}),
      ...(typeof query.userId === "string" ? { userId: query.userId } : {}),
      ...(typeof query.status === "string" ? { status: query.status } : {}),
      ...(typeof query.kind === "string" ? { kind: query.kind } : {}),
      ...(typeof query.providerOrderId === "string" ? { providerOrderId: query.providerOrderId } : {}),
      ...(typeof query.providerPaymentId === "string"
        ? { providerPaymentId: query.providerPaymentId }
        : {}),
      ...(from && !Number.isNaN(from.getTime()) && to && !Number.isNaN(to.getTime())
        ? { createdAt: { gte: from, lte: to } }
        : {}),
      ...(Object.keys(economicsFilter).length > 0 ? { economics: { is: economicsFilter } } : {}),
    };
    const [items, total] = await this.prismaService.client.$transaction([
      this.prismaService.client.payment.findMany({
        where,
        include: { economics: true },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      this.prismaService.client.payment.count({ where }),
    ]);
    return {
      total,
      take,
      skip,
      items: items.map((item) => ({
        id: item.id,
        userId: item.userId,
        status: item.status,
        kind: item.kind,
        amountMicroRub: item.amountMicroRub.toString(),
        providerOrderId: item.providerOrderId,
        providerPaymentId: item.providerPaymentId,
        createdAt: item.createdAt.toISOString(),
        paymentMethod: item.economics?.paymentMethod ?? null,
        economicsStatus: item.economics?.economicsStatus ?? null,
      })),
    };
  }

  async getPayment(paymentId: string) {
    const payment = await this.prismaService.client.payment.findUnique({
      where: { id: paymentId },
      include: { economics: true, events: { orderBy: { processedAt: "asc" }, take: 50 } },
    });
    if (!payment) {
      return null;
    }
    return {
      id: payment.id,
      userId: payment.userId,
      status: payment.status,
      kind: payment.kind,
      amountMicroRub: payment.amountMicroRub.toString(),
      providerOrderId: payment.providerOrderId,
      providerPaymentId: payment.providerPaymentId,
      createdAt: payment.createdAt.toISOString(),
      checkoutSnapshot: payment.checkoutSnapshot,
      economics: payment.economics
        ? {
            paymentMethod: payment.economics.paymentMethod,
            economicsStatus: payment.economics.economicsStatus,
            estimatedAcquiringFeeMicroRub: payment.economics.estimatedAcquiringFeeMicroRub?.toString() ?? null,
            actualAcquiringFeeMicroRub: payment.economics.actualAcquiringFeeMicroRub?.toString() ?? null,
            estimatedFiscalizationFeeMicroRub:
              payment.economics.estimatedFiscalizationFeeMicroRub?.toString() ?? null,
            actualFiscalizationFeeMicroRub: payment.economics.actualFiscalizationFeeMicroRub?.toString() ?? null,
            refundedAmountMicroRub: payment.economics.refundedAmountMicroRub.toString(),
            chargebackAmountMicroRub: payment.economics.chargebackAmountMicroRub.toString(),
          }
        : null,
      events: payment.events.map((event) => ({
        id: event.id,
        type: event.eventType,
        createdAt: event.processedAt.toISOString(),
      })),
    };
  }

  async listAudit(query: Record<string, unknown>) {
    const take = boundLimit(query.limit);
    const skip = boundOffset(query.offset);
    const [items, total] = await this.prismaService.client.$transaction([
      this.prismaService.client.adminAuditLog.findMany({
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      this.prismaService.client.adminAuditLog.count(),
    ]);
    return { items, total, take, skip };
  }

  async listAdminSessions() {
    return this.prismaService.client.adminSession.findMany({
      where: { revokedAt: null },
      select: {
        id: true,
        principalId: true,
        createdAt: true,
        expiresAt: true,
        idleExpiresAt: true,
        lastStrongAuthAt: true,
        lastSeenAt: true,
      },
      take: 100,
      orderBy: { createdAt: "desc" },
    });
  }

  async listPlans() {
    const plans = await this.prismaService.client.plan.findMany({
      include: {
        versions: {
          include: { entitlements: true },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { code: "asc" },
    });
    return plans.map((plan) => ({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      active: plan.active,
      versions: plan.versions.map((version) => ({
        id: version.id,
        status: version.status,
        priceMicroRub: version.priceMicroRub.toString(),
        monthlyUsageGrantMicroRub: version.providerBudgetMicroRub.toString(),
        subscriptionPeriodDays: version.subscriptionPeriodDays,
        publishedAt: version.publishedAt?.toISOString() ?? null,
        retiredAt: version.retiredAt?.toISOString() ?? null,
        entitlements: version.entitlements.map((item) => ({
          key: item.key,
          valueKind: item.valueKind,
          unlimited: item.unlimited,
          intValue: item.intValue?.toString() ?? null,
          boolValue: item.boolValue,
        })),
      })),
    }));
  }

  async listModels() {
    return this.prismaService.client.aiModel.findMany({
      include: { priceVersions: { orderBy: { effectiveFrom: "desc" }, take: 5 } },
      orderBy: { slug: "asc" },
    });
  }

  async aiStatus() {
    return {
      envEnabled: this.config.aiTextEnabled,
      operatorDisabled: await isAiTextOperatorDisabled(this.prismaService.client),
      secrets: this.secretsStatus(),
    };
  }

  async listSecurityEvents() {
    return this.prismaService.client.adminSecurityEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
}

function boundLimit(value: unknown): number {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : 50;
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 50;
  }
  return Math.min(Math.trunc(parsed), 100);
}

function boundOffset(value: unknown): number {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : 0;
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.min(Math.trunc(parsed), 10_000);
}
