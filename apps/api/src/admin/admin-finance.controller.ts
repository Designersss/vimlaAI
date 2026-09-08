import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { microRubToJson } from "@vimla/billing";
import { AdminGuard, AdminOriginGuard } from "./admin.guard.js";
import { AdminPermissionGuard } from "./admin-permission.guard.js";
import { RequireAdminPermission } from "./admin-permission.decorator.js";
import { AdminFacade } from "./admin.service.js";

@Controller("admin/v1/finance")
@UseGuards(AdminOriginGuard, AdminGuard, AdminPermissionGuard)
export class AdminFinanceController {
  constructor(@Inject(AdminFacade) private readonly admin: AdminFacade) {}

  @Get("overview")
  @RequireAdminPermission("finance.read")
  async overview(@Query() query: Record<string, unknown>): Promise<unknown> {
    const filter = this.admin.parseRange(query);
    const overview = await this.admin.finance.overview(filter);
    const usage = await this.admin.finance.usageSplit(filter);
    const methods = await this.admin.finance.paymentMethodAnalytics(filter);
    const models = await this.admin.finance.modelEconomics(filter);
    const timezone = this.admin.reportingTimezone(query);
    const series = await this.admin.finance.timeseries(filter, timezone);
    return {
      timezone,
      overview: serializeOverview(overview),
      usage: {
        monthlyGrantedMicroRub: microRubToJson(usage.monthlyGrantedMicroRub),
        monthlyConsumedMicroRub: microRubToJson(usage.monthlyConsumedMicroRub),
        monthlyExpiredUnusedMicroRub: microRubToJson(usage.monthlyExpiredUnusedMicroRub),
        topupGrantedMicroRub: microRubToJson(usage.topupGrantedMicroRub),
        topupConsumedMicroRub: microRubToJson(usage.topupConsumedMicroRub),
        topupOutstandingMicroRub: microRubToJson(usage.topupOutstandingMicroRub),
        topupNeverExpires: true,
      },
      paymentMethods: methods.map((row) => ({
        ...row,
        grossRevenueMicroRub: microRubToJson(row.grossRevenueMicroRub),
        estimatedFeesMicroRub: microRubToJson(row.estimatedFeesMicroRub),
        actualFeesMicroRub: microRubToJson(row.actualFeesMicroRub),
        usedFeesMicroRub: microRubToJson(row.usedFeesMicroRub),
      })),
      models: models.map((row) => ({
        ...row,
        inputTokens: row.inputTokens.toString(),
        outputTokens: row.outputTokens.toString(),
        providerActualCostMicroRub: microRubToJson(row.providerActualCostMicroRub),
        userSettledUsageMicroRub: microRubToJson(row.userSettledUsageMicroRub),
        differenceMicroRub: microRubToJson(row.differenceMicroRub),
        averageCostPerRequestMicroRub: row.averageCostPerRequestMicroRub
          ? microRubToJson(row.averageCostPerRequestMicroRub)
          : null,
      })),
      series: series.map((point) => ({
        date: point.date,
        grossRevenueMicroRub: microRubToJson(point.grossRevenueMicroRub),
        realizedAiCogsMicroRub: microRubToJson(point.realizedAiCogsMicroRub),
        realizedContributionMicroRub: microRubToJson(point.realizedContributionMicroRub),
      })),
    };
  }

  @Get("reconciliation")
  @RequireAdminPermission("finance.read")
  async reconciliation() {
    return this.admin.reconciliationQueue();
  }
}

function serializeOverview(overview: {
  grossRevenueMicroRub: bigint;
  refundsMicroRub: bigint;
  chargebackAmountMicroRub: bigint;
  netSalesMicroRub: bigint;
  estimatedPaymentFeesMicroRub: bigint;
  actualPaymentFeesMicroRub: bigint;
  usedPaymentFeesMicroRub: bigint;
  estimatedFiscalizationFeesMicroRub: bigint;
  actualFiscalizationFeesMicroRub: bigint;
  usedFiscalizationFeesMicroRub: bigint;
  realizedAiCogsMicroRub: bigint;
  knownVariableCostsMicroRub: bigint;
  outstandingMonthlyUsageMicroRub: bigint;
  outstandingTopupUsageMicroRub: bigint;
  totalOutstandingUsageMicroRub: bigint;
  expiredMonthlyUsageMicroRub: bigint;
  estimatedTaxReserveMicroRub: bigint | null;
  realizedContributionMicroRub: bigint;
  conservativeContributionMicroRub: bigint;
  realizedMarginBps: number | null;
  conservativeMarginBps: number | null;
  paymentFeeQuality: string;
  fiscalizationFeeQuality: string;
  overallQuality: string;
  expectedMarginBps: number | null;
  expectedMarginQuality: string;
}) {
  return {
    grossRevenueMicroRub: microRubToJson(overview.grossRevenueMicroRub),
    refundsMicroRub: microRubToJson(overview.refundsMicroRub),
    chargebackAmountMicroRub: microRubToJson(overview.chargebackAmountMicroRub),
    netSalesMicroRub: microRubToJson(overview.netSalesMicroRub),
    estimatedPaymentFeesMicroRub: microRubToJson(overview.estimatedPaymentFeesMicroRub),
    actualPaymentFeesMicroRub: microRubToJson(overview.actualPaymentFeesMicroRub),
    usedPaymentFeesMicroRub: microRubToJson(overview.usedPaymentFeesMicroRub),
    estimatedFiscalizationFeesMicroRub: microRubToJson(overview.estimatedFiscalizationFeesMicroRub),
    actualFiscalizationFeesMicroRub: microRubToJson(overview.actualFiscalizationFeesMicroRub),
    usedFiscalizationFeesMicroRub: microRubToJson(overview.usedFiscalizationFeesMicroRub),
    realizedAiCogsMicroRub: microRubToJson(overview.realizedAiCogsMicroRub),
    knownVariableCostsMicroRub: microRubToJson(overview.knownVariableCostsMicroRub),
    outstandingMonthlyUsageMicroRub: microRubToJson(overview.outstandingMonthlyUsageMicroRub),
    outstandingTopupUsageMicroRub: microRubToJson(overview.outstandingTopupUsageMicroRub),
    totalOutstandingUsageMicroRub: microRubToJson(overview.totalOutstandingUsageMicroRub),
    expiredMonthlyUsageMicroRub: microRubToJson(overview.expiredMonthlyUsageMicroRub),
    estimatedTaxReserveMicroRub: overview.estimatedTaxReserveMicroRub
      ? microRubToJson(overview.estimatedTaxReserveMicroRub)
      : null,
    realizedContributionMicroRub: microRubToJson(overview.realizedContributionMicroRub),
    conservativeContributionMicroRub: microRubToJson(overview.conservativeContributionMicroRub),
    realizedMarginBps: overview.realizedMarginBps,
    conservativeMarginBps: overview.conservativeMarginBps,
    paymentFeeQuality: overview.paymentFeeQuality,
    fiscalizationFeeQuality: overview.fiscalizationFeeQuality,
    overallQuality: overview.overallQuality,
    expectedMarginBps: overview.expectedMarginBps,
    expectedMarginQuality: overview.expectedMarginQuality,
    labels: {
      contributionNotNetProfit: true,
      taxReserveIsEstimate: true,
    },
  };
}
