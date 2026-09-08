import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  BillingEngine,
  MockPaymentProvider,
  PaymentMetrics,
  PaymentService,
  TBankHttpTransport,
  TBankPaymentProvider,
  isDevBillingEnvironment,
  type BillingLogger,
  type BillingPolicy,
  type PaymentProvider,
} from "@vimla/billing";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { billingPolicyFromConfig } from "./billing-policy.js";

@Injectable()
export class BillingService {
  readonly engine: BillingEngine;
  readonly payments: PaymentService;
  readonly metrics = new PaymentMetrics();
  readonly hostedProvider: PaymentProvider;
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(API_CONFIG) config: ApiRuntimeConfig,
  ) {
    const policy: BillingPolicy = billingPolicyFromConfig(config);
    const billingLogger = this.billingLogger();
    this.engine = new BillingEngine(prisma.client, policy, billingLogger);
    this.hostedProvider = createHostedProvider(config);
    this.payments = new PaymentService(
      this.engine,
      this.hostedProvider,
      {
        notificationUrl: config.tbankNotificationUrl,
        successUrl: config.tbankSuccessUrl,
        failUrl: config.tbankFailUrl,
      },
      {
        terminalKey: config.tbankTerminalKey,
        password: config.tbankPassword,
      },
      billingLogger,
      this.metrics,
    );
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

function createHostedProvider(config: ApiRuntimeConfig): PaymentProvider {
  if (config.paymentProvider === "mock") {
    if (!isDevBillingEnvironment(config.appEnv)) {
      throw new Error("Mock payment provider is not allowed in staging/production");
    }
    return new MockPaymentProvider(true);
  }

  return new TBankPaymentProvider(
    {
      terminalKey: config.tbankTerminalKey,
      password: config.tbankPassword,
      apiBaseUrl: config.tbankApiBaseUrl,
      fiscalization: {
        enabled: config.tbankFiscalizationEnabled,
        taxation: config.tbankReceiptTaxation,
        tax: config.tbankReceiptTax,
        paymentMethod: config.tbankReceiptPaymentMethod,
        paymentObject: config.tbankReceiptPaymentObject,
        ffdVersion: config.tbankReceiptFfdVersion,
        itemName: config.tbankReceiptItemName,
      },
    },
    new TBankHttpTransport(config.tbankApiBaseUrl),
  );
}
