import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import type { AdminActor } from "@vimla/admin";
import { microRubFromJson } from "@vimla/billing";
import { AdminGuard, AdminOriginGuard } from "./admin.guard.js";
import { AdminPermissionGuard } from "./admin-permission.guard.js";
import { RequireAdminPermission } from "./admin-permission.decorator.js";
import { AdminFacade } from "./admin.service.js";

@Controller("admin/v1")
@UseGuards(AdminOriginGuard, AdminGuard, AdminPermissionGuard)
export class AdminExplorerController {
  constructor(@Inject(AdminFacade) private readonly admin: AdminFacade) {}

  @Get("users")
  @RequireAdminPermission("users.read")
  listUsers(@Query() query: Record<string, unknown>) {
    return this.admin.listUsers(query);
  }

  @Get("users/:id")
  @RequireAdminPermission("users.read")
  getUser(@Param("id") id: string) {
    return this.admin.getUser(id);
  }

  @Get("payments")
  @RequireAdminPermission("finance.read")
  listPayments(@Query() query: Record<string, unknown>) {
    return this.admin.listPayments(query);
  }

  @Get("payments/:id")
  @RequireAdminPermission("finance.read")
  getPayment(@Param("id") id: string) {
    return this.admin.getPayment(id);
  }

  @Get("security/audit")
  @RequireAdminPermission("security.audit.read")
  audit(@Query() query: Record<string, unknown>) {
    return this.admin.listAudit(query);
  }

  @Get("security/sessions")
  @RequireAdminPermission("security.audit.read")
  sessions() {
    return this.admin.listAdminSessions();
  }

  @Get("security/events")
  @RequireAdminPermission("security.audit.read")
  events() {
    return this.admin.listSecurityEvents();
  }

  @Get("ai")
  @RequireAdminPermission("ai.read")
  async ai() {
    const [status, models] = await Promise.all([this.admin.aiStatus(), this.admin.listModels()]);
    return {
      status,
      models: models.map((model) => ({
        id: model.id,
        slug: model.slug,
        displayName: model.displayName,
        vendor: model.vendor,
        active: model.active,
        prices: model.priceVersions.map((price) => ({
          id: price.id,
          effectiveFrom: price.effectiveFrom.toISOString(),
          effectiveTo: price.effectiveTo?.toISOString() ?? null,
          inputMicroRubPerMillion: price.inputMicroRubPerMillion.toString(),
          outputMicroRubPerMillion: price.outputMicroRubPerMillion.toString(),
          cacheReadMicroRubPerMillion: price.cacheReadMicroRubPerMillion?.toString() ?? null,
          cacheWriteMicroRubPerMillion: price.cacheWriteMicroRubPerMillion?.toString() ?? null,
        })),
      })),
    };
  }

  @Post("ai/kill-switch")
  @RequireAdminPermission("ai.manage", { stepUp: true })
  killSwitch(@Req() request: FastifyRequest, @Body() body: unknown) {
    const parsed = z.object({ disabled: z.boolean(), reason: z.string().min(3) }).strict().parse(body);
    return this.admin.setAiKillSwitch(
      request.adminActor as AdminActor,
      parsed.disabled,
      parsed.reason,
      String(request.id),
    );
  }

  @Get("settings/secrets")
  @RequireAdminPermission("admin.manage")
  secrets() {
    return this.admin.secretsStatus();
  }

  @Get("settings/economics")
  @RequireAdminPermission("finance.read")
  async economics() {
    const [guardrail, fees, fiscal, tax] = await Promise.all([
      this.admin.policies.publishedGuardrail(),
      this.admin.policies.publishedFeePolicies(),
      this.admin.policies.publishedFiscalization(),
      this.admin.policies.publishedTaxReserve(),
    ]);
    return {
      guardrail,
      fees: fees.map((fee) => ({
        ...fee,
        minimumFeeMicroRub: fee.minimumFeeMicroRub?.toString() ?? null,
        fixedFeeMicroRub: fee.fixedFeeMicroRub?.toString() ?? null,
        unverified: fee.sourceQuality !== "VERIFIED",
      })),
      fiscalization: fiscal
        ? {
            ...fiscal,
            fixedFeeMicroRub: fiscal.fixedFeeMicroRub?.toString() ?? null,
            unverified: fiscal.sourceQuality !== "VERIFIED",
          }
        : null,
      taxReserve: tax,
      merchantTariffConfigured: fees.some((fee) => fee.sourceQuality === "VERIFIED"),
    };
  }

  @Post("settings/economics/guardrails")
  @RequireAdminPermission("finance.manage", { stepUp: true })
  async createGuardrail(@Req() request: FastifyRequest, @Body() body: unknown) {
    const parsed = z
      .object({
        targetMinimumMarginBps: z.number().int().min(0).max(10_000),
        projectCreationWindowDays: z.number().int().min(1).nullable(),
        projectCreationLimitFree: z.number().int().min(0).nullable(),
        projectCreationLimit199: z.number().int().min(0).nullable(),
        projectCreationLimit499: z.number().int().min(0).nullable(),
        projectCreationLimit999: z.number().int().min(0).nullable(),
        freeActiveProjectReallocationCooldownDays: z.number().int().min(0).nullable(),
        projectTrashRetentionDays: z.number().int().min(0).nullable(),
        sourceQuality: z.enum(["UNVERIFIED", "VERIFIED"]).default("UNVERIFIED"),
      })
      .strict()
      .parse(body);
    const created = await this.admin.policies.createGuardrailDraft({
      ...parsed,
      createdByUserId: (request.adminActor as AdminActor).userId,
    });
    await this.admin.control.audit({
      adminUserId: (request.adminActor as AdminActor).userId,
      principalId: (request.adminActor as AdminActor).principalId,
      adminSessionId: (request.adminActor as AdminActor).sessionId,
      action: "BUSINESS_GUARDRAIL_CHANGED",
      resourceType: "BusinessGuardrailVersion",
      resourceId: created.id,
      requestId: String(request.id),
    });
    return created;
  }

  @Post("settings/economics/guardrails/:id/publish")
  @RequireAdminPermission("finance.manage", { stepUp: true })
  async publishGuardrail(@Req() request: FastifyRequest, @Param("id") id: string) {
    const published = await this.admin.policies.publishGuardrail(id);
    await this.admin.control.audit({
      adminUserId: (request.adminActor as AdminActor).userId,
      principalId: (request.adminActor as AdminActor).principalId,
      adminSessionId: (request.adminActor as AdminActor).sessionId,
      action: "BUSINESS_GUARDRAIL_CHANGED",
      resourceType: "BusinessGuardrailVersion",
      resourceId: published.id,
      requestId: String(request.id),
    });
    return published;
  }

  @Post("settings/payment-fees")
  @RequireAdminPermission("finance.manage", { stepUp: true })
  async createFee(@Req() request: FastifyRequest, @Body() body: unknown) {
    const parsed = z
      .object({
        provider: z.string().min(1),
        paymentMethod: z.enum(["CARD", "SBP", "T_PAY", "OTHER"]),
        feeBps: z.number().int().min(0).max(10_000),
        feeVatBps: z.number().int().min(0).max(10_000),
        minimumFeeMicroRub: z.string().regex(/^\d+$/).nullable(),
        fixedFeeMicroRub: z.string().regex(/^\d+$/).nullable(),
        sourceDescription: z.string().min(1),
        sourceQuality: z.enum(["UNVERIFIED", "VERIFIED"]),
        verifiedAt: z.string().datetime().nullable(),
      })
      .strict()
      .parse(body);
    const created = await this.admin.policies.createPaymentFeeDraft({
      ...parsed,
      minimumFeeMicroRub: parsed.minimumFeeMicroRub ? microRubFromJson(parsed.minimumFeeMicroRub) : null,
      fixedFeeMicroRub: parsed.fixedFeeMicroRub ? microRubFromJson(parsed.fixedFeeMicroRub) : null,
      verifiedAt: parsed.verifiedAt ? new Date(parsed.verifiedAt) : null,
      createdByUserId: (request.adminActor as AdminActor).userId,
    });
    await this.admin.control.audit({
      adminUserId: (request.adminActor as AdminActor).userId,
      principalId: (request.adminActor as AdminActor).principalId,
      adminSessionId: (request.adminActor as AdminActor).sessionId,
      action: "PAYMENT_FEE_POLICY_CHANGED",
      resourceType: "PaymentFeePolicyVersion",
      resourceId: created.id,
      requestId: String(request.id),
    });
    return created;
  }

  @Post("settings/payment-fees/:id/publish")
  @RequireAdminPermission("finance.manage", { stepUp: true })
  async publishFee(@Req() request: FastifyRequest, @Param("id") id: string) {
    const published = await this.admin.policies.publishPaymentFee(id);
    await this.admin.control.audit({
      adminUserId: (request.adminActor as AdminActor).userId,
      principalId: (request.adminActor as AdminActor).principalId,
      adminSessionId: (request.adminActor as AdminActor).sessionId,
      action: "PAYMENT_FEE_POLICY_CHANGED",
      resourceType: "PaymentFeePolicyVersion",
      resourceId: published.id,
      requestId: String(request.id),
    });
    return published;
  }

  @Post("settings/fiscalization")
  @RequireAdminPermission("finance.manage", { stepUp: true })
  async createFiscal(@Req() request: FastifyRequest, @Body() body: unknown) {
    const parsed = z
      .object({
        provider: z.string().min(1),
        mode: z.string().min(1),
        percentageBps: z.number().int().min(0).max(10_000).nullable(),
        fixedFeeMicroRub: z.string().regex(/^\d+$/).nullable(),
        sourceDescription: z.string().min(1),
        sourceQuality: z.enum(["UNVERIFIED", "VERIFIED"]),
        verifiedAt: z.string().datetime().nullable(),
      })
      .strict()
      .parse(body);
    const created = await this.admin.policies.createFiscalizationDraft({
      ...parsed,
      fixedFeeMicroRub: parsed.fixedFeeMicroRub ? microRubFromJson(parsed.fixedFeeMicroRub) : null,
      verifiedAt: parsed.verifiedAt ? new Date(parsed.verifiedAt) : null,
      createdByUserId: (request.adminActor as AdminActor).userId,
    });
    await this.admin.control.audit({
      adminUserId: (request.adminActor as AdminActor).userId,
      principalId: (request.adminActor as AdminActor).principalId,
      adminSessionId: (request.adminActor as AdminActor).sessionId,
      action: "FISCAL_POLICY_CHANGED",
      resourceType: "FiscalizationFeePolicyVersion",
      resourceId: created.id,
      requestId: String(request.id),
    });
    return created;
  }

  @Post("settings/fiscalization/:id/publish")
  @RequireAdminPermission("finance.manage", { stepUp: true })
  async publishFiscal(@Req() request: FastifyRequest, @Param("id") id: string) {
    const published = await this.admin.policies.publishFiscalization(id);
    await this.admin.control.audit({
      adminUserId: (request.adminActor as AdminActor).userId,
      principalId: (request.adminActor as AdminActor).principalId,
      adminSessionId: (request.adminActor as AdminActor).sessionId,
      action: "FISCAL_POLICY_CHANGED",
      resourceType: "FiscalizationFeePolicyVersion",
      resourceId: published.id,
      requestId: String(request.id),
    });
    return published;
  }

  @Post("settings/tax-reserve")
  @RequireAdminPermission("finance.manage", { stepUp: true })
  async createTaxReserve(@Req() request: FastifyRequest, @Body() body: unknown) {
    const parsed = z
      .object({
        reserveBps: z.number().int().min(0).max(10_000),
        enabled: z.boolean(),
        sourceQuality: z.enum(["UNVERIFIED", "ESTIMATE"]),
      })
      .strict()
      .parse(body);
    const created = await this.admin.policies.createTaxReserveDraft({
      ...parsed,
      createdByUserId: (request.adminActor as AdminActor).userId,
    });
    await this.admin.control.audit({
      adminUserId: (request.adminActor as AdminActor).userId,
      principalId: (request.adminActor as AdminActor).principalId,
      adminSessionId: (request.adminActor as AdminActor).sessionId,
      action: "TAX_RESERVE_POLICY_CHANGED",
      resourceType: "TaxReservePolicyVersion",
      resourceId: created.id,
      requestId: String(request.id),
    });
    return created;
  }

  @Post("settings/tax-reserve/:id/publish")
  @RequireAdminPermission("finance.manage", { stepUp: true })
  async publishTaxReserve(@Req() request: FastifyRequest, @Param("id") id: string) {
    const published = await this.admin.policies.publishTaxReserve(id);
    await this.admin.control.audit({
      adminUserId: (request.adminActor as AdminActor).userId,
      principalId: (request.adminActor as AdminActor).principalId,
      adminSessionId: (request.adminActor as AdminActor).sessionId,
      action: "TAX_RESERVE_POLICY_CHANGED",
      resourceType: "TaxReservePolicyVersion",
      resourceId: published.id,
      requestId: String(request.id),
    });
    return published;
  }
}
