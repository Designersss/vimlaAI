import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import type { AdminActor } from "@vimla/admin";
import {
  assertWritableEntitlementKey,
  BillingError,
  microRubFromJson,
  type PlanEntitlementRecord,
} from "@vimla/billing";
import { AdminGuard, AdminOriginGuard } from "./admin.guard.js";
import { AdminPermissionGuard } from "./admin-permission.guard.js";
import { RequireAdminPermission } from "./admin-permission.decorator.js";
import { AdminFacade } from "./admin.service.js";

const entitlementSchema = z.object({
  key: z.string(),
  value: z.union([
    z.object({ kind: z.enum(["COUNT", "BYTES"]), unlimited: z.literal(true) }),
    z.object({
      kind: z.enum(["COUNT", "BYTES"]),
      unlimited: z.literal(false),
      value: z.string().regex(/^\d+$/),
    }),
    z.object({ kind: z.literal("BOOLEAN"), value: z.boolean() }),
    z.object({ kind: z.literal("TBD") }),
  ]),
});

const draftSchema = z
  .object({
    planId: z.string().min(1),
    priceMicroRub: z.string().regex(/^\d+$/),
    monthlyUsageGrantMicroRub: z.string().regex(/^\d+$/),
    subscriptionPeriodDays: z.number().int().min(1).max(366),
    entitlements: z.array(entitlementSchema),
  })
  .strict();

const publishSchema = z
  .object({
    acknowledgeNegativeOrLowMargin: z.boolean().optional(),
    reason: z.string().min(1).optional(),
    typedPlanCode: z.string().min(1).optional(),
  })
  .strict();

const topupDraftSchema = z
  .object({
    minPurchaseMicroRub: z.string().regex(/^\d+$/),
    maxPurchaseMicroRub: z.string().regex(/^\d+$/),
    usageGrantRatioBps: z.number().int().min(0).max(10_000),
  })
  .strict()
  .refine((value) => !("expiry" in value) && !("expiresAt" in value), {
    message: "Top-up expiry does not exist",
  });

function entitlementsFromBody(
  items: z.infer<typeof entitlementSchema>[],
): PlanEntitlementRecord[] {
  return items.map((item) => {
    let key: PlanEntitlementRecord["key"];
    try {
      key = assertWritableEntitlementKey(item.key);
    } catch (error) {
      throw new BillingError(
        "ENTITLEMENT_INVALID",
        error instanceof Error ? error.message : `Invalid entitlement key: ${item.key}`,
      );
    }
    if (item.value.kind === "COUNT" || item.value.kind === "BYTES") {
      if (item.value.unlimited) {
        return { key, value: { kind: item.value.kind, unlimited: true } };
      }
      return {
        key,
        value: { kind: item.value.kind, unlimited: false, value: BigInt(item.value.value) },
      };
    }
    if (item.value.kind === "BOOLEAN") {
      return { key, value: { kind: "BOOLEAN", value: item.value.value } };
    }
    return { key, value: { kind: "TBD" } };
  });
}

@Controller("admin/v1/tariffs")
@UseGuards(AdminOriginGuard, AdminGuard, AdminPermissionGuard)
export class AdminTariffsController {
  constructor(@Inject(AdminFacade) private readonly admin: AdminFacade) {}

  @Get("plans")
  @RequireAdminPermission("tariffs.read")
  listPlans() {
    return this.admin.listPlans();
  }

  @Post("plans/drafts")
  @RequireAdminPermission("tariffs.manage", { stepUp: true })
  createDraft(@Req() request: FastifyRequest, @Body() body: unknown) {
    const parsed = draftSchema.parse(body);
    return this.admin.createDraft(
      request.adminActor as AdminActor,
      {
        planId: parsed.planId,
        priceMicroRub: microRubFromJson(parsed.priceMicroRub),
        monthlyUsageGrantMicroRub: microRubFromJson(parsed.monthlyUsageGrantMicroRub),
        subscriptionPeriodDays: parsed.subscriptionPeriodDays,
        entitlements: entitlementsFromBody(parsed.entitlements),
      },
      String(request.id),
    );
  }

  @Patch("plans/:id")
  @RequireAdminPermission("tariffs.manage", { stepUp: true })
  updateDraft(@Req() request: FastifyRequest, @Param("id") id: string, @Body() body: unknown) {
    const parsed = draftSchema.omit({ planId: true }).parse(body);
    return this.admin.updateDraft(
      request.adminActor as AdminActor,
      id,
      {
        priceMicroRub: microRubFromJson(parsed.priceMicroRub),
        monthlyUsageGrantMicroRub: microRubFromJson(parsed.monthlyUsageGrantMicroRub),
        subscriptionPeriodDays: parsed.subscriptionPeriodDays,
        entitlements: entitlementsFromBody(parsed.entitlements),
      },
      String(request.id),
    );
  }

  @Post("plans/:id/simulate")
  @HttpCode(HttpStatus.OK)
  @RequireAdminPermission("tariffs.read")
  async simulate(@Param("id") id: string): Promise<unknown> {
    return this.admin.tariffs.simulatePlanVersion(id, await this.admin.simulationAssumptions());
  }

  @Post("plans/:id/publish")
  @HttpCode(HttpStatus.OK)
  @RequireAdminPermission("tariffs.manage", { stepUp: true })
  async publish(@Req() request: FastifyRequest, @Param("id") id: string, @Body() body: unknown) {
    const parsed = publishSchema.parse(body);
    const confirmation =
      parsed.acknowledgeNegativeOrLowMargin && parsed.reason && parsed.typedPlanCode
        ? {
            acknowledgeNegativeOrLowMargin: true,
            reason: parsed.reason,
            typedPlanCode: parsed.typedPlanCode,
          }
        : null;
    return this.admin.publishPlan(
      request.adminActor as AdminActor,
      id,
      confirmation,
      String(request.id),
    );
  }

  @Post("plans/:id/retire")
  @HttpCode(HttpStatus.OK)
  @RequireAdminPermission("tariffs.manage", { stepUp: true })
  retire(@Req() request: FastifyRequest, @Param("id") id: string) {
    return this.admin.retirePlan(request.adminActor as AdminActor, id, String(request.id));
  }

  @Get("top-up")
  @RequireAdminPermission("tariffs.read")
  async topup() {
    const current = await this.admin.policies.publishedTopup();
    const drafts = await this.admin.policies.listTopupPolicies();
    return {
      current: current
        ? {
            ...current,
            minPurchaseMicroRub: current.minPurchaseMicroRub.toString(),
            maxPurchaseMicroRub: current.maxPurchaseMicroRub.toString(),
          }
        : null,
      versions: drafts.map((item) => ({
        ...item,
        minPurchaseMicroRub: item.minPurchaseMicroRub.toString(),
        maxPurchaseMicroRub: item.maxPurchaseMicroRub.toString(),
      })),
      expirySupported: false,
    };
  }

  @Post("top-up/drafts")
  @RequireAdminPermission("tariffs.manage", { stepUp: true })
  async createTopup(@Req() request: FastifyRequest, @Body() body: unknown) {
    const parsed = topupDraftSchema.parse(body);
    const created = await this.admin.policies.createTopupDraft({
      minPurchaseMicroRub: microRubFromJson(parsed.minPurchaseMicroRub),
      maxPurchaseMicroRub: microRubFromJson(parsed.maxPurchaseMicroRub),
      usageGrantRatioBps: parsed.usageGrantRatioBps,
      createdByUserId: (request.adminActor as AdminActor).userId,
    });
    await this.admin.control.audit({
      adminUserId: (request.adminActor as AdminActor).userId,
      principalId: (request.adminActor as AdminActor).principalId,
      adminSessionId: (request.adminActor as AdminActor).sessionId,
      action: "TOPUP_POLICY_CREATED",
      resourceType: "TopupPolicyVersion",
      resourceId: created.id,
      requestId: String(request.id),
    });
    return created;
  }

  @Post("top-up/:id/publish")
  @RequireAdminPermission("tariffs.manage", { stepUp: true })
  async publishTopup(@Req() request: FastifyRequest, @Param("id") id: string) {
    const published = await this.admin.policies.publishTopup(id);
    await this.admin.control.audit({
      adminUserId: (request.adminActor as AdminActor).userId,
      principalId: (request.adminActor as AdminActor).principalId,
      adminSessionId: (request.adminActor as AdminActor).sessionId,
      action: "TOPUP_POLICY_PUBLISHED",
      resourceType: "TopupPolicyVersion",
      resourceId: published.id,
      requestId: String(request.id),
    });
    return published;
  }

  @Post("top-up/simulate")
  @HttpCode(HttpStatus.OK)
  @RequireAdminPermission("tariffs.read")
  async simulateTopup(@Body() body: unknown): Promise<unknown> {
    const parsed = z
      .object({
        amountMicroRub: z.string().regex(/^\d+$/),
        usageGrantRatioBps: z.number().int().min(0).max(10_000),
      })
      .strict()
      .parse(body);
    const assumptions = await this.admin.simulationAssumptions();
    return this.admin.tariffs.simulateTopup({
      amountMicroRub: microRubFromJson(parsed.amountMicroRub),
      usageGrantRatioBps: BigInt(parsed.usageGrantRatioBps),
      paymentFees: assumptions.paymentFees,
      fiscalization: assumptions.fiscalization,
      taxReserveBps: assumptions.taxReserveBps,
      targetMinimumMarginBps: assumptions.targetMinimumMarginBps,
    });
  }
}
