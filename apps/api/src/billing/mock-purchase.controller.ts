import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@vimla/auth";
import {
  BillingError,
  isDevBillingEnvironment,
  microRubFromJson,
  MOCK_PAYMENT_PROVIDER_ID,
  MockPaymentProvider,
} from "@vimla/billing";
import {
  mockSubscriptionPurchaseSchema,
  mockTopupPurchaseSchema,
} from "@vimla/contracts";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { BillingService } from "./billing.service.js";
import { MockPurchaseRateLimitGuard } from "./mock-purchase.rate-limit.js";

@Controller("dev/mock-purchases")
@UseGuards(AuthGuard, MockPurchaseRateLimitGuard)
export class MockPurchaseController {
  private readonly mockProvider: MockPaymentProvider;

  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(API_CONFIG) config: ApiRuntimeConfig,
  ) {
    if (!isDevBillingEnvironment(config.appEnv)) {
      throw new BillingError(
        "MOCK_PROVIDER_DISABLED",
        "Mock purchases are not available",
      );
    }

    this.mockProvider = new MockPaymentProvider(true);
  }

  @Post("subscription")
  @HttpCode(201)
  async buySubscription(
    @AuthUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<{ paymentId: string; subscriptionId: string | null }> {
    const parsed = mockSubscriptionPurchaseSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid subscription purchase payload");
    }

    const plan = await this.billing.engine.findCurrentPlanVersionByCode(parsed.data.planCode);
    const created = this.mockProvider.createPayment("SUBSCRIPTION");
    const pending = await this.billing.engine.createPendingPayment({
      userId: user.id,
      provider: MOCK_PAYMENT_PROVIDER_ID,
      providerPaymentId: created.providerPaymentId,
      kind: "SUBSCRIPTION",
      amountMicroRub: plan.priceMicroRub,
      planVersionId: plan.planVersionId,
    });
    const result = await this.billing.engine.processPaymentEvent(
      this.mockProvider.succeed(created.providerPaymentId),
    );

    return { paymentId: pending.paymentId, subscriptionId: result.subscriptionId };
  }

  @Post("topup")
  @HttpCode(201)
  async buyTopup(
    @AuthUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<{ paymentId: string; bucketId: string | null }> {
    const parsed = mockTopupPurchaseSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid top-up payload");
    }

    let amountMicroRub: bigint;
    try {
      amountMicroRub = microRubFromJson(parsed.data.amountMicroRub);
    } catch {
      throw new BadRequestException("Invalid top-up amount");
    }

    const created = this.mockProvider.createPayment("TOPUP");
    const pending = await this.billing.engine.createPendingPayment({
      userId: user.id,
      provider: MOCK_PAYMENT_PROVIDER_ID,
      providerPaymentId: created.providerPaymentId,
      kind: "TOPUP",
      amountMicroRub,
    });
    const result = await this.billing.engine.processPaymentEvent(
      this.mockProvider.succeed(created.providerPaymentId),
    );

    return { paymentId: pending.paymentId, bucketId: result.bucketId };
  }
}
