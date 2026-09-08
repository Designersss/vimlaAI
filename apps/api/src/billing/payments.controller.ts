import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@vimla/auth";
import { microRubFromJson } from "@vimla/billing";
import {
  checkoutResponseSchema,
  paymentViewSchema,
  paymentsResponseSchema,
  subscriptionCheckoutSchema,
  topupCheckoutSchema,
  type CheckoutResponse,
  type PaymentsResponse,
  type PaymentView,
} from "@vimla/contracts";
import { AuthGuard } from "../auth/auth.guard.js";
import { AuthUser } from "../auth/current-user.decorator.js";
import { SensitiveArea } from "../auth/sensitive-area.js";
import { SensitiveAreaGuard } from "../auth/sensitive-area.guard.js";
import { BillingService } from "./billing.service.js";
import { PaymentCheckoutRateLimitGuard } from "./payment-checkout.rate-limit.js";

@Controller("v1/payments")
@SensitiveArea()
@UseGuards(AuthGuard, SensitiveAreaGuard)
export class PaymentsController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Post("subscriptions")
  @HttpCode(201)
  @UseGuards(PaymentCheckoutRateLimitGuard)
  async checkoutSubscription(
    @AuthUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<CheckoutResponse> {
    const parsed = subscriptionCheckoutSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "validation_error",
        message: "Invalid subscription checkout payload",
      });
    }
    const result = await this.billing.payments.checkoutSubscription({
      userId: user.id,
      planCode: parsed.data.planCode,
      idempotencyKey: parsed.data.idempotencyKey,
      locale: "ru",
    });
    return checkoutResponseSchema.parse(result);
  }

  @Post("topups")
  @HttpCode(201)
  @UseGuards(PaymentCheckoutRateLimitGuard)
  async checkoutTopup(
    @AuthUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<CheckoutResponse> {
    const parsed = topupCheckoutSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "validation_error",
        message: "Invalid top-up checkout payload",
      });
    }
    let amountMicroRub: bigint;
    try {
      amountMicroRub = microRubFromJson(parsed.data.amountMicroRub);
    } catch {
      throw new BadRequestException({
        code: "payment_amount_invalid",
        message: "Invalid top-up amount",
      });
    }
    const result = await this.billing.payments.checkoutTopup({
      userId: user.id,
      amountMicroRub,
      idempotencyKey: parsed.data.idempotencyKey,
      locale: "ru",
    });
    return checkoutResponseSchema.parse(result);
  }

  @Get()
  async list(@AuthUser() user: AuthenticatedUser): Promise<PaymentsResponse> {
    const payments = await this.billing.payments.listPayments(user.id);
    return paymentsResponseSchema.parse({ payments });
  }

  @Get(":id")
  async get(
    @AuthUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ): Promise<PaymentView> {
    const payment = await this.billing.payments.getPayment(user.id, id);
    return paymentViewSchema.parse(payment);
  }
}
