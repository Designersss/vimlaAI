import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  BillingEngine,
  type BillingLogger,
  type BillingPolicy,
} from "@vimla/billing";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { billingPolicyFromConfig } from "./billing-policy.js";

@Injectable()
export class BillingService {
  readonly engine: BillingEngine;
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(API_CONFIG) config: ApiRuntimeConfig,
  ) {
    const policy: BillingPolicy = billingPolicyFromConfig(config);
    this.engine = new BillingEngine(prisma.client, policy, this.billingLogger());
  }

  private billingLogger(): BillingLogger {
    return {
      info: (fields, message) => {
        this.logger.log({ ...fields, message });
      },
      warn: (fields, message) => {
        this.logger.warn({ ...fields, message });
      },
      error: (fields, message) => {
        this.logger.error({ ...fields, message });
      },
    };
  }
}
