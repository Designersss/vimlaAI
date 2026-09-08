import { Prisma, type PrismaClient } from "@vimla/database";
import { chooseFee, estimateTaxReserve, mergeQuality } from "./fee-estimate.js";
import type { CohortEconomics, FinanceOverview, FinanceQueryFilter, FinanceTimeseriesPoint, ModelEconomicsRow, PaymentMethodAnalyticsRow, UsageSplit, UsageUtilization } from "./finance-types.js";
import { marginBpsFloor, usedPercentFloor, type MicroRub } from "./money.js";
import type { BillingLogger } from "./types.js";

const silentLogger: BillingLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

type MoneyRow = Record<string, string | bigint | null>;

export class FinanceQueryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: BillingLogger = silentLogger,
  ) {}

  async overview(filter: FinanceQueryFilter = {}, now = new Date()): Promise<FinanceOverview> {
    const sales = await this.loadSales(filter);
    const outstanding = await this.loadOutstanding(filter, now);
    const expiredMonthly = await this.loadExpiredMonthly(filter, now);
    const aiCogs = await this.loadAiCogs(filter);
    const variable = await this.loadVariableCosts(filter);
    const taxPolicy = await this.publishedTaxReserve(now);

    const usedPayment = chooseFee(sales.actualPaymentFees, sales.estimatedPaymentFees);
    const usedFiscal = chooseFee(sales.actualFiscalizationFees, sales.estimatedFiscalizationFees);
    const paymentFeeQuality = mergeFeeQuality(sales);
    const fiscalizationFeeQuality = mergeFiscalQuality(sales);
    const taxReserve =
      taxPolicy && taxPolicy.enabled
        ? estimateTaxReserve(sales.netSales, BigInt(taxPolicy.reserveBps))
        : null;

    const realizedContribution =
      sales.netSales -
      usedPayment.amount -
      usedFiscal.amount -
      aiCogs -
      variable -
      (taxReserve ?? 0n);
    const totalOutstanding = outstanding.monthly + outstanding.topup;
    const conservativeContribution = realizedContribution - totalOutstanding;

    const utilization = await this.utilization(filter, now);
    let expectedMarginBps: number | null = null;
    let expectedMarginQuality: FinanceOverview["expectedMarginQuality"] = "INSUFFICIENT_DATA";
    if (utilization.consumedMicroRub > 0n && utilization.grantMicroRub > 0n) {
      const expectedAi = (utilization.grantMicroRub * BigInt(utilization.utilizationPercent ?? 0)) / 100n;
      const expectedContribution =
        sales.netSales - usedPayment.amount - usedFiscal.amount - expectedAi - variable - (taxReserve ?? 0n);
      expectedMarginBps = marginBpsFloor(expectedContribution, sales.netSales);
      expectedMarginQuality = "ESTIMATED";
    }

    if (conservativeContribution < 0n) {
      this.logger.warn(
        { operation: "financeOverview", result: "negative_conservative_margin" },
        "Conservative contribution is negative",
      );
    }
    if (
      sales.actualPaymentFees > 0n &&
      sales.estimatedPaymentFees > 0n &&
      sales.actualPaymentFees !== sales.estimatedPaymentFees
    ) {
      this.logger.warn(
        { operation: "financeOverview", result: "actual_vs_estimated_fee_mismatch" },
        "Actual acquiring fees differ from estimates",
      );
    }

    return {
      grossRevenueMicroRub: sales.gross,
      refundsMicroRub: sales.refunds,
      chargebackAmountMicroRub: sales.chargebacks,
      netSalesMicroRub: sales.netSales,
      estimatedPaymentFeesMicroRub: sales.estimatedPaymentFees,
      actualPaymentFeesMicroRub: sales.actualPaymentFees,
      usedPaymentFeesMicroRub: usedPayment.amount,
      estimatedFiscalizationFeesMicroRub: sales.estimatedFiscalizationFees,
      actualFiscalizationFeesMicroRub: sales.actualFiscalizationFees,
      usedFiscalizationFeesMicroRub: usedFiscal.amount,
      realizedAiCogsMicroRub: aiCogs,
      knownVariableCostsMicroRub: variable,
      outstandingMonthlyUsageMicroRub: outstanding.monthly,
      outstandingTopupUsageMicroRub: outstanding.topup,
      totalOutstandingUsageMicroRub: totalOutstanding,
      expiredMonthlyUsageMicroRub: expiredMonthly,
      estimatedTaxReserveMicroRub: taxReserve,
      realizedContributionMicroRub: realizedContribution,
      conservativeContributionMicroRub: conservativeContribution,
      realizedMarginBps: marginBpsFloor(realizedContribution, sales.netSales),
      conservativeMarginBps: marginBpsFloor(conservativeContribution, sales.netSales),
      paymentFeeQuality,
      fiscalizationFeeQuality,
      overallQuality: mergeQuality([paymentFeeQuality, fiscalizationFeeQuality, "ACTUAL"]),
      expectedMarginBps,
      expectedMarginQuality,
    };
  }

  async cohort(filter: FinanceQueryFilter, now = new Date()): Promise<CohortEconomics> {
    const overview = await this.overview(filter, now);
    return {
      ...overview,
      planVersionId: filter.planVersionId ?? null,
      paymentKind: filter.paymentKind ?? null,
      utilization: await this.utilization(filter, now),
    };
  }

  async utilization(filter: FinanceQueryFilter = {}, now = new Date()): Promise<UsageUtilization> {
    const rows = await this.prisma.$queryRaw<MoneyRow[]>`
      SELECT
        COALESCE(SUM(b."totalMicroRub"), 0)::text AS grant,
        COALESCE(SUM(b."spentMicroRub"), 0)::text AS consumed,
        COALESCE(SUM(
          CASE
            WHEN b.type = 'MONTHLY' AND b."expiresAt" IS NOT NULL AND b."expiresAt" <= ${now}
              THEN 0
            ELSE b."totalMicroRub" - b."spentMicroRub"
          END
        ), 0)::text AS remaining,
        COALESCE(SUM(
          CASE
            WHEN b.type = 'MONTHLY' AND b."expiresAt" IS NOT NULL AND b."expiresAt" <= ${now}
              THEN b."totalMicroRub" - b."spentMicroRub"
            ELSE 0
          END
        ), 0)::text AS expired
      FROM usage_bucket b
      ${bucketJoin(filter)}
      ${bucketWhere(filter)}
    `;
    const grant = money(rows[0]?.grant);
    const consumed = money(rows[0]?.consumed);
    const remaining = money(rows[0]?.remaining);
    const expiredUnused = money(rows[0]?.expired);
    return {
      grantMicroRub: grant,
      consumedMicroRub: consumed,
      remainingMicroRub: remaining,
      expiredUnusedMicroRub: expiredUnused,
      utilizationPercent: grant > 0n ? usedPercentFloor(consumed, grant) : null,
    };
  }

  async usageSplit(filter: FinanceQueryFilter = {}, now = new Date()): Promise<UsageSplit> {
    const rows = await this.prisma.$queryRaw<Array<{ type: string; grant: string; consumed: string; remaining: string; expired: string }>>`
      SELECT
        b.type,
        COALESCE(SUM(b."totalMicroRub"), 0)::text AS grant,
        COALESCE(SUM(b."spentMicroRub"), 0)::text AS consumed,
        COALESCE(SUM(
          CASE
            WHEN b.type = 'MONTHLY' AND b."expiresAt" IS NOT NULL AND b."expiresAt" <= ${now}
              THEN 0
            ELSE b."totalMicroRub" - b."spentMicroRub"
          END
        ), 0)::text AS remaining,
        COALESCE(SUM(
          CASE
            WHEN b.type = 'MONTHLY' AND b."expiresAt" IS NOT NULL AND b."expiresAt" <= ${now}
              THEN b."totalMicroRub" - b."spentMicroRub"
            ELSE 0
          END
        ), 0)::text AS expired
      FROM usage_bucket b
      ${bucketJoin(filter)}
      ${bucketWhere(filter)}
      GROUP BY b.type
    `;
    const monthly = rows.find((row) => row.type === "MONTHLY");
    const topup = rows.find((row) => row.type === "TOPUP");
    return {
      monthlyGrantedMicroRub: money(monthly?.grant),
      monthlyConsumedMicroRub: money(monthly?.consumed),
      monthlyExpiredUnusedMicroRub: money(monthly?.expired),
      topupGrantedMicroRub: money(topup?.grant),
      topupConsumedMicroRub: money(topup?.consumed),
      topupOutstandingMicroRub: money(topup?.remaining),
    };
  }

  async paymentMethodAnalytics(filter: FinanceQueryFilter = {}): Promise<PaymentMethodAnalyticsRow[]> {
    const rows = await this.prisma.$queryRaw<Array<{
      method: string | null;
      payment_count: string;
      gross: string;
      est_fee: string;
      act_fee: string;
      actual_count: string;
    }>>`
      SELECT
        COALESCE(e."paymentMethod", 'UNKNOWN') AS method,
        COUNT(*)::text AS payment_count,
        COALESCE(SUM(p."amountMicroRub"), 0)::text AS gross,
        COALESCE(SUM(COALESCE(e."estimatedAcquiringFeeMicroRub", 0) + COALESCE(e."estimatedAcquiringFeeVatMicroRub", 0)), 0)::text AS est_fee,
        COALESCE(SUM(COALESCE(e."actualAcquiringFeeMicroRub", 0) + COALESCE(e."actualAcquiringFeeVatMicroRub", 0)), 0)::text AS act_fee,
        COUNT(e."actualAcquiringFeeMicroRub")::text AS actual_count
      FROM payment p
      LEFT JOIN payment_economics e ON e."paymentId" = p.id
      ${paymentWhere(filter)}
      GROUP BY COALESCE(e."paymentMethod", 'UNKNOWN')
      ORDER BY method
    `;
    return rows.map((row) => {
      const gross = money(row.gross);
      const estimated = money(row.est_fee);
      const actual = money(row.act_fee);
      const used = actual > 0n ? actual : estimated;
      const paymentCount = Number(row.payment_count);
      const actualCount = Number(row.actual_count);
      const feeQuality =
        actualCount === paymentCount && paymentCount > 0
          ? "ACTUAL"
          : actualCount > 0
            ? "PARTIAL"
            : estimated > 0n
              ? "ESTIMATED"
              : "UNKNOWN";
      return {
        paymentMethod: row.method ?? "UNKNOWN",
        paymentCount,
        grossRevenueMicroRub: gross,
        estimatedFeesMicroRub: estimated,
        actualFeesMicroRub: actual,
        usedFeesMicroRub: used,
        feeQuality,
        effectiveFeeBps: gross > 0n ? Number((used * 10_000n) / gross) : null,
      };
    });
  }

  async modelEconomics(filter: FinanceQueryFilter = {}): Promise<ModelEconomicsRow[]> {
    const rows = await this.prisma.$queryRaw<Array<{
      model_id: string;
      slug: string;
      request_count: string;
      input_tokens: string;
      output_tokens: string;
      cogs: string;
      usage_charged: string;
    }>>`
      SELECT
        m.id AS model_id,
        m.slug,
        COUNT(r.id)::text AS request_count,
        COALESCE(SUM(r."actualInputTokens"), 0)::text AS input_tokens,
        COALESCE(SUM(r."actualOutputTokens"), 0)::text AS output_tokens,
        COALESCE(SUM(r."providerActualCostMicroRub"), 0)::text AS cogs,
        COALESCE(SUM(r."userSettledUsageMicroRub"), 0)::text AS usage_charged
      FROM ai_request r
      INNER JOIN ai_model m ON m.id = r."modelId"
      WHERE r."providerActualCostMicroRub" IS NOT NULL
        ${createdAtSql("r", filter)}
      GROUP BY m.id, m.slug
      ORDER BY m.slug
    `;
    return rows.map((row) => {
      const requestCount = Number(row.request_count);
      const cogs = money(row.cogs);
      const charged = money(row.usage_charged);
      return {
        modelId: row.model_id,
        slug: row.slug,
        requestCount,
        inputTokens: BigInt(row.input_tokens),
        outputTokens: BigInt(row.output_tokens),
        providerActualCostMicroRub: cogs,
        userSettledUsageMicroRub: charged,
        differenceMicroRub: charged - cogs,
        averageCostPerRequestMicroRub: requestCount > 0 ? cogs / BigInt(requestCount) : null,
      };
    });
  }

  async timeseries(
    filter: FinanceQueryFilter,
    timezone: string,
  ): Promise<FinanceTimeseriesPoint[]> {
    assertIanaTimeZone(timezone);
    const rows = await this.prisma.$queryRaw<Array<{ day: string; gross: string; cogs: string; fees: string }>>`
      WITH sales AS (
        SELECT
          (p."createdAt" AT TIME ZONE ${timezone})::date::text AS day,
          COALESCE(SUM(p."amountMicroRub" - COALESCE(e."refundedAmountMicroRub", 0)), 0)::text AS gross,
          COALESCE(SUM(
            COALESCE(e."actualAcquiringFeeMicroRub", e."estimatedAcquiringFeeMicroRub", 0)
            + COALESCE(e."actualAcquiringFeeVatMicroRub", e."estimatedAcquiringFeeVatMicroRub", 0)
            + COALESCE(e."actualFiscalizationFeeMicroRub", e."estimatedFiscalizationFeeMicroRub", 0)
          ), 0)::text AS fees
        FROM payment p
        LEFT JOIN payment_economics e ON e."paymentId" = p.id
        ${paymentWhere(filter)}
        GROUP BY 1
      ),
      cogs AS (
        SELECT
          (r."createdAt" AT TIME ZONE ${timezone})::date::text AS day,
          COALESCE(SUM(r."providerActualCostMicroRub"), 0)::text AS cogs
        FROM ai_request r
        WHERE r."providerActualCostMicroRub" IS NOT NULL
          ${createdAtSql("r", filter)}
        GROUP BY 1
      )
      SELECT
        COALESCE(sales.day, cogs.day) AS day,
        COALESCE(sales.gross, '0') AS gross,
        COALESCE(cogs.cogs, '0') AS cogs,
        COALESCE(sales.fees, '0') AS fees
      FROM sales
      FULL OUTER JOIN cogs ON cogs.day = sales.day
      ORDER BY 1
    `;
    return rows.map((row) => {
      const gross = money(row.gross);
      const cogs = money(row.cogs);
      const fees = money(row.fees);
      return {
        date: row.day,
        grossRevenueMicroRub: gross,
        realizedAiCogsMicroRub: cogs,
        realizedContributionMicroRub: gross - fees - cogs,
      };
    });
  }

  private async loadSales(filter: FinanceQueryFilter) {
    const rows = await this.prisma.$queryRaw<MoneyRow[]>`
      SELECT
        COALESCE(SUM(p."amountMicroRub"), 0)::text AS gross,
        COALESCE(SUM(COALESCE(e."refundedAmountMicroRub", 0)), 0)::text AS refunds,
        COALESCE(SUM(COALESCE(e."chargebackAmountMicroRub", 0)), 0)::text AS chargebacks,
        COALESCE(SUM(COALESCE(e."estimatedAcquiringFeeMicroRub", 0) + COALESCE(e."estimatedAcquiringFeeVatMicroRub", 0)), 0)::text AS est_fee,
        COALESCE(SUM(COALESCE(e."actualAcquiringFeeMicroRub", 0) + COALESCE(e."actualAcquiringFeeVatMicroRub", 0)), 0)::text AS act_fee,
        COALESCE(SUM(e."estimatedFiscalizationFeeMicroRub"), 0)::text AS est_fiscal,
        COALESCE(SUM(e."actualFiscalizationFeeMicroRub"), 0)::text AS act_fiscal,
        COUNT(*)::text AS payment_count,
        COUNT(e.id)::text AS economics_count,
        COUNT(e."actualAcquiringFeeMicroRub")::text AS actual_fee_count
      FROM payment p
      LEFT JOIN payment_economics e ON e."paymentId" = p.id
      ${paymentWhere(filter)}
    `;
    const gross = money(rows[0]?.gross);
    const refunds = money(rows[0]?.refunds);
    const chargebacks = money(rows[0]?.chargebacks);
    return {
      gross,
      refunds,
      chargebacks,
      netSales: gross - refunds,
      estimatedPaymentFees: money(rows[0]?.est_fee),
      actualPaymentFees: money(rows[0]?.act_fee),
      estimatedFiscalizationFees: money(rows[0]?.est_fiscal),
      actualFiscalizationFees: money(rows[0]?.act_fiscal),
      paymentCount: Number(rows[0]?.payment_count ?? 0),
      economicsCount: Number(rows[0]?.economics_count ?? 0),
      actualFeeCount: Number(rows[0]?.actual_fee_count ?? 0),
    };
  }

  private async loadOutstanding(filter: FinanceQueryFilter, now: Date) {
    const rows = await this.prisma.$queryRaw<Array<{ type: string; remaining: string }>>`
      SELECT
        b.type,
        COALESCE(SUM(b."totalMicroRub" - b."spentMicroRub"), 0)::text AS remaining
      FROM usage_bucket b
      ${bucketJoin(filter)}
      WHERE
        ${bucketFilterSql(filter)}
        AND (
          b.type = 'TOPUP'
          OR (b.type = 'MONTHLY' AND (b."expiresAt" IS NULL OR b."expiresAt" > ${now}))
        )
      GROUP BY b.type
    `;
    return {
      monthly: money(rows.find((row) => row.type === "MONTHLY")?.remaining),
      topup: money(rows.find((row) => row.type === "TOPUP")?.remaining),
    };
  }

  private async loadExpiredMonthly(filter: FinanceQueryFilter, now: Date) {
    const rows = await this.prisma.$queryRaw<MoneyRow[]>`
      SELECT COALESCE(SUM(b."totalMicroRub" - b."spentMicroRub"), 0)::text AS expired
      FROM usage_bucket b
      ${bucketJoin(filter)}
      WHERE
        ${bucketFilterSql(filter)}
        AND b.type = 'MONTHLY'
        AND b."expiresAt" IS NOT NULL
        AND b."expiresAt" <= ${now}
    `;
    return money(rows[0]?.expired);
  }

  private async loadAiCogs(filter: FinanceQueryFilter) {
    const rows = await this.prisma.$queryRaw<MoneyRow[]>`
      SELECT COALESCE(SUM(r."providerActualCostMicroRub"), 0)::text AS cogs
      FROM ai_request r
      WHERE r."providerActualCostMicroRub" IS NOT NULL
        AND r."reservationId" IN (
          SELECT DISTINCT a."reservationId"
          FROM usage_reservation_allocation a
          INNER JOIN usage_bucket b ON b.id = a."bucketId"
          ${bucketJoin(filter)}
          WHERE ${bucketFilterSql(filter)}
        )
        ${createdAtSql("r", filter)}
    `;
    return money(rows[0]?.cogs);
  }

  private async loadVariableCosts(filter: FinanceQueryFilter) {
    const rows = await this.prisma.$queryRaw<MoneyRow[]>`
      SELECT COALESCE(SUM("amountMicroRub"), 0)::text AS amount
      FROM variable_cost_entry
      WHERE 1 = 1
        ${occurredAtSql(filter)}
    `;
    return money(rows[0]?.amount);
  }

  private async publishedTaxReserve(now: Date) {
    return this.prisma.taxReservePolicyVersion.findFirst({
      where: {
        status: "PUBLISHED",
        enabled: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });
  }
}

function money(value: string | bigint | null | undefined): MicroRub {
  if (value === null || value === undefined) {
    return 0n;
  }
  return typeof value === "bigint" ? value : BigInt(value);
}

function mergeFeeQuality(sales: {
  paymentCount: number;
  economicsCount: number;
  actualFeeCount: number;
  estimatedPaymentFees: bigint;
}): "ACTUAL" | "ESTIMATED" | "PARTIAL" | "UNKNOWN" {
  if (sales.paymentCount === 0) {
    return "UNKNOWN";
  }
  if (sales.economicsCount < sales.paymentCount) {
    return sales.actualFeeCount > 0 ? "PARTIAL" : "UNKNOWN";
  }
  if (sales.actualFeeCount === sales.paymentCount) {
    return "ACTUAL";
  }
  if (sales.actualFeeCount > 0) {
    return "PARTIAL";
  }
  return sales.estimatedPaymentFees > 0n ? "ESTIMATED" : "UNKNOWN";
}

function mergeFiscalQuality(sales: {
  paymentCount: number;
  actualFiscalizationFees: bigint;
  estimatedFiscalizationFees: bigint;
}): "ACTUAL" | "ESTIMATED" | "PARTIAL" | "UNKNOWN" {
  if (sales.actualFiscalizationFees > 0n && sales.estimatedFiscalizationFees > 0n) {
    return "PARTIAL";
  }
  if (sales.actualFiscalizationFees > 0n) {
    return "ACTUAL";
  }
  if (sales.estimatedFiscalizationFees > 0n) {
    return "ESTIMATED";
  }
  return "UNKNOWN";
}

function paymentWhere(filter: FinanceQueryFilter): Prisma.Sql {
  return Prisma.sql`
    WHERE p.status IN ('SUCCEEDED', 'REFUNDED', 'PARTIALLY_REFUNDED')
      ${createdAtSql("p", filter)}
      ${filter.planVersionId ? Prisma.sql`AND p."planVersionId" = ${filter.planVersionId}` : Prisma.empty}
      ${filter.paymentKind ? Prisma.sql`AND p.kind = ${filter.paymentKind}` : Prisma.empty}
      ${filter.userId ? Prisma.sql`AND p."userId" = ${filter.userId}` : Prisma.empty}
  `;
}

function bucketJoin(filter: FinanceQueryFilter): Prisma.Sql {
  if (!filter.planVersionId && !filter.paymentKind && !filter.from && !filter.to && !filter.userId) {
    return Prisma.empty;
  }
  return Prisma.sql`
    INNER JOIN payment p ON (
      (b."sourceType" = 'PAYMENT' AND b."sourceId" = p.id)
      OR (b."sourceType" = 'SUBSCRIPTION' AND b."sourceId" = p."grantedSubscriptionId")
    )
  `;
}

function bucketWhere(filter: FinanceQueryFilter): Prisma.Sql {
  if (!filter.planVersionId && !filter.paymentKind && !filter.from && !filter.to && !filter.userId) {
    return Prisma.empty;
  }
  return Prisma.sql`WHERE ${bucketFilterSql(filter)}`;
}

function bucketFilterSql(filter: FinanceQueryFilter): Prisma.Sql {
  if (!filter.planVersionId && !filter.paymentKind && !filter.from && !filter.to && !filter.userId) {
    return Prisma.sql`TRUE`;
  }
  return Prisma.sql`
    p.status IN ('SUCCEEDED', 'REFUNDED', 'PARTIALLY_REFUNDED')
    ${createdAtSql("p", filter)}
    ${filter.planVersionId ? Prisma.sql`AND p."planVersionId" = ${filter.planVersionId}` : Prisma.empty}
    ${filter.paymentKind ? Prisma.sql`AND p.kind = ${filter.paymentKind}` : Prisma.empty}
    ${filter.userId ? Prisma.sql`AND p."userId" = ${filter.userId}` : Prisma.empty}
  `;
}

function createdAtSql(alias: "p" | "r", filter: FinanceQueryFilter): Prisma.Sql {
  if (alias === "r") {
    return Prisma.sql`
      ${filter.from ? Prisma.sql`AND r."createdAt" >= ${filter.from}` : Prisma.empty}
      ${filter.to ? Prisma.sql`AND r."createdAt" < ${filter.to}` : Prisma.empty}
    `;
  }
  return Prisma.sql`
    ${filter.from ? Prisma.sql`AND p."createdAt" >= ${filter.from}` : Prisma.empty}
    ${filter.to ? Prisma.sql`AND p."createdAt" < ${filter.to}` : Prisma.empty}
  `;
}

function occurredAtSql(filter: FinanceQueryFilter): Prisma.Sql {
  return Prisma.sql`
    ${filter.from ? Prisma.sql`AND "occurredAt" >= ${filter.from}` : Prisma.empty}
    ${filter.to ? Prisma.sql`AND "occurredAt" < ${filter.to}` : Prisma.empty}
  `;
}

function assertIanaTimeZone(value: string): void {
  if (!Intl.supportedValuesOf("timeZone").includes(value)) {
    throw new Error("Invalid reporting timezone");
  }
}
