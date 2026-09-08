import {
  Controller,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { isBillingError } from "@vimla/billing";
import { BillingService } from "./billing.service.js";
import { TbankWebhookRateLimitGuard } from "./tbank-webhook.rate-limit.js";

@Controller()
export class TbankWebhookController {
  private readonly logger = new Logger(TbankWebhookController.name);

  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Post("webhooks/tbank/payments")
  @HttpCode(200)
  @UseGuards(TbankWebhookRateLimitGuard)
  async handle(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const contentType = String(request.headers["content-type"] ?? "");
    if (
      !contentType.includes("application/json") &&
      !contentType.includes("application/x-www-form-urlencoded")
    ) {
      void reply.status(415).type("text/plain").send("Unsupported Media Type");
      return;
    }

    const payload = request.body;
    if (!isBoundedNotification(payload)) {
      this.logger.warn({ result: "payload_rejected" }, "Rejected oversized payment notification");
      void reply.status(400).type("text/plain").send("Bad Request");
      return;
    }

    try {
      await this.billing.payments.handleProviderNotification(payload);
      void reply.status(200).type("text/plain").send("OK");
    } catch (error: unknown) {
      if (isBillingError(error) && error.code === "PAYMENT_NOTIFICATION_INVALID") {
        this.billing.metrics.recordInvalidSignature();
        this.logger.error(
          { result: "invalid_signature", requestId: String(request.id) },
          "Rejected payment notification with invalid signature",
        );
        void reply.status(400).type("text/plain").send("Bad Request");
        return;
      }
      this.logger.error(
        {
          result: "notification_failed",
          requestId: String(request.id),
          errorName: error instanceof Error ? error.name : "unknown",
        },
        "Payment notification processing failed",
      );
      void reply.status(503).type("text/plain").send("Service Unavailable");
    }
  }
}

function isBoundedNotification(payload: unknown): payload is Record<string, unknown> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0 || keys.length > 40) {
    return false;
  }
  return JSON.stringify(record).length <= 16_384;
}
