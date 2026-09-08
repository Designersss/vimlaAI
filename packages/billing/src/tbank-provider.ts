import { kopecksToMicroRub, microRubToKopecks, type MicroRub } from "./money.js";
import { BillingError } from "./errors.js";
import { signTBankToken, verifyTBankToken } from "./tbank-token.js";
import { classifyTBankStatus } from "./payment-states.js";
import { normalizePaymentMethod } from "./payment-method.js";
import type {
  HostedCheckoutInput,
  HostedCheckoutResult,
  PaymentProvider,
  ProviderPaymentState,
} from "./payment-provider.js";

export const TBANK_PAYMENT_PROVIDER_ID = "tbank";

export const DEFAULT_TBANK_API_BASE_URL = {
  test: "https://rest-api-test.tinkoff.ru",
  production: "https://securepay.tinkoff.ru",
} as const;

export interface TBankFiscalizationConfig {
  enabled: boolean;
  taxation?: string;
  tax?: string;
  paymentMethod?: string;
  paymentObject?: string;
  ffdVersion?: string;
  itemName?: string;
}

export interface TBankProviderConfig {
  terminalKey: string;
  password: string;
  apiBaseUrl: string;
  timeoutMs?: number;
  fiscalization: TBankFiscalizationConfig;
}

export interface TBankTransport {
  post(path: string, body: Record<string, unknown>): Promise<unknown>;
}

export interface VerifiedTBankNotification {
  terminalKey: string;
  orderId: string;
  paymentId: string;
  status: string;
  success: boolean;
  amountMicroRub: MicroRub;
  errorCode?: string;
  rebillId?: string;
  paymentMethod?: string;
  rawProviderSource?: string;
}

export class TBankHttpTransport implements TBankTransport {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly timeoutMs = 15_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.apiBaseUrl.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new BillingError("PAYMENT_PROVIDER_UNAVAILABLE", "Payment provider request failed");
      }
      return payload;
    } catch (error: unknown) {
      if (error instanceof BillingError) {
        throw error;
      }
      throw new BillingError("PAYMENT_PROVIDER_UNAVAILABLE", "Payment provider is unavailable");
    } finally {
      clearTimeout(timer);
    }
  }
}

export class TBankPaymentProvider implements PaymentProvider {
  readonly id = TBANK_PAYMENT_PROVIDER_ID;

  constructor(
    private readonly config: TBankProviderConfig,
    private readonly transport: TBankTransport,
  ) {}

  async createHostedCheckout(input: HostedCheckoutInput): Promise<HostedCheckoutResult> {
    const amount = microRubToKopecks(input.amountMicroRub);
    const request: Record<string, unknown> = {
      TerminalKey: this.config.terminalKey,
      Amount: Number(amount),
      OrderId: input.orderId,
      Description: input.description.slice(0, 140),
      Language: input.language,
      NotificationURL: input.notificationUrl,
      SuccessURL: input.successUrl,
      FailURL: input.failUrl,
      PayType: "O",
    };
    const receipt = this.buildReceipt(amount, input.description);
    if (receipt) {
      request.Receipt = receipt;
    }
    request.Token = signTBankToken(request, this.config.password);

    let payload: unknown;
    try {
      payload = await this.transport.post("/v2/Init", request);
    } catch (error: unknown) {
      const recovered = await this.checkOrder(input.orderId);
      if (recovered) {
        return recovered;
      }
      throw error;
    }

    const parsed = parseInitResponse(payload);
    if (!parsed.success || !parsed.paymentUrl || !parsed.paymentId) {
      const recovered = await this.checkOrder(input.orderId);
      if (recovered) {
        return recovered;
      }
      throw new BillingError("PAYMENT_PROVIDER_UNAVAILABLE", "Payment provider rejected Init");
    }

    return {
      providerPaymentId: parsed.paymentId,
      paymentUrl: parsed.paymentUrl,
      providerStatus: parsed.status ?? "NEW",
    };
  }

  async getState(providerPaymentId: string): Promise<ProviderPaymentState> {
    const request: Record<string, unknown> = {
      TerminalKey: this.config.terminalKey,
      PaymentId: providerPaymentId,
    };
    request.Token = signTBankToken(request, this.config.password);
    const payload = await this.withReadRetry(() => this.transport.post("/v2/GetState", request));
    return parseStateResponse(payload);
  }

  async checkOrder(orderId: string): Promise<HostedCheckoutResult | null> {
    const request: Record<string, unknown> = {
      TerminalKey: this.config.terminalKey,
      OrderId: orderId,
    };
    request.Token = signTBankToken(request, this.config.password);
    try {
      const payload = await this.withReadRetry(() => this.transport.post("/v2/CheckOrder", request));
      return parseCheckOrder(payload);
    } catch {
      return null;
    }
  }

  async cancel(input: { providerPaymentId: string; amountMicroRub?: MicroRub }): Promise<ProviderPaymentState> {
    const request: Record<string, unknown> = {
      TerminalKey: this.config.terminalKey,
      PaymentId: input.providerPaymentId,
    };
    if (input.amountMicroRub !== undefined) {
      request.Amount = Number(microRubToKopecks(input.amountMicroRub));
    }
    request.Token = signTBankToken(request, this.config.password);
    const payload = await this.transport.post("/v2/Cancel", request);
    return parseStateResponse(payload);
  }

  verifyNotification(payload: unknown): VerifiedTBankNotification {
    return verifyTBankNotification(payload, this.config.terminalKey, this.config.password);
  }

  private buildReceipt(amountKopecks: bigint, description: string): Record<string, unknown> | null {
    const fiscal = this.config.fiscalization;
    if (!fiscal.enabled) {
      return null;
    }
    if (!fiscal.taxation || !fiscal.tax) {
      throw new BillingError(
        "FINANCIAL_OPERATION_FAILED",
        "Fiscalization is enabled but receipt tax configuration is incomplete",
      );
    }
    const itemAmount = Number(amountKopecks);
    return {
      Taxation: fiscal.taxation,
      Items: [
        {
          Name: (fiscal.itemName ?? description).slice(0, 128),
          Price: itemAmount,
          Quantity: 1,
          Amount: itemAmount,
          Tax: fiscal.tax,
          PaymentMethod: fiscal.paymentMethod ?? "full_payment",
          PaymentObject: fiscal.paymentObject ?? "service",
        },
      ],
    };
  }

  private async withReadRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await fn();
      } catch (error: unknown) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** (attempt - 1)));
      }
    }
    throw lastError;
  }
}

export class MockTBankTransport implements TBankTransport {
  readonly inits: Record<string, unknown>[] = [];
  failNextInit = false;
  private readonly orders = new Map<
    string,
    { paymentId: string; status: string; amount: number; paymentUrl: string }
  >();

  constructor(private readonly paymentUrlBase = "https://mock.tbank.local/pay") {}

  seed(orderId: string, payment: { paymentId: string; status: string; amount: number; paymentUrl?: string }): void {
    this.orders.set(orderId, {
      paymentId: payment.paymentId,
      status: payment.status,
      amount: payment.amount,
      paymentUrl: payment.paymentUrl ?? `${this.paymentUrlBase}/${payment.paymentId}`,
    });
  }

  setStatus(orderId: string, status: string): void {
    const current = this.orders.get(orderId);
    if (current) {
      current.status = status;
    }
  }

  async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    if (path === "/v2/Init") {
      const recorded = { ...body };
      delete recorded.Token;
      this.inits.push(recorded);
      const orderId = String(body.OrderId);
      const existing = this.orders.get(orderId);
      if (existing) {
        return {
          Success: true,
          ErrorCode: "0",
          Status: existing.status,
          PaymentId: existing.paymentId,
          OrderId: orderId,
          Amount: existing.amount,
          PaymentURL: existing.paymentUrl,
        };
      }
      const paymentId = `tb_${this.inits.length}_${orderId}`.slice(0, 20);
      const paymentUrl = `${this.paymentUrlBase}/${paymentId}`;
      this.orders.set(orderId, {
        paymentId,
        status: "NEW",
        amount: Number(body.Amount),
        paymentUrl,
      });
      if (this.failNextInit) {
        this.failNextInit = false;
        throw new BillingError("PAYMENT_PROVIDER_UNAVAILABLE", "Payment provider is unavailable");
      }
      return {
        Success: true,
        ErrorCode: "0",
        Status: "NEW",
        PaymentId: paymentId,
        OrderId: orderId,
        Amount: body.Amount,
        PaymentURL: paymentUrl,
      };
    }

    if (path === "/v2/GetState") {
      const paymentId = String(body.PaymentId);
      for (const [orderId, order] of this.orders) {
        if (order.paymentId === paymentId) {
          return {
            Success: true,
            ErrorCode: "0",
            Status: order.status,
            PaymentId: order.paymentId,
            OrderId: orderId,
            Amount: order.amount,
          };
        }
      }
      return { Success: false, ErrorCode: "8", Message: "Payment not found" };
    }

    if (path === "/v2/CheckOrder") {
      const orderId = String(body.OrderId);
      const order = this.orders.get(orderId);
      if (!order) {
        return { Success: false, ErrorCode: "8", Message: "Order not found" };
      }
      return {
        Success: true,
        ErrorCode: "0",
        OrderId: orderId,
        Payments: [
          {
            PaymentId: order.paymentId,
            Amount: order.amount,
            Status: order.status,
          },
        ],
      };
    }

    if (path === "/v2/Cancel") {
      const paymentId = String(body.PaymentId);
      for (const [orderId, order] of this.orders) {
        if (order.paymentId === paymentId) {
          order.status = body.Amount && Number(body.Amount) < order.amount ? "PARTIAL_REFUNDED" : "REFUNDED";
          return {
            Success: true,
            ErrorCode: "0",
            Status: order.status,
            PaymentId: order.paymentId,
            OrderId: orderId,
            Amount: order.amount,
          };
        }
      }
    }

    return { Success: false, ErrorCode: "99", Message: "Unknown method" };
  }
}

export function verifyTBankNotification(
  payload: unknown,
  terminalKey: string,
  password: string,
): VerifiedTBankNotification {
  if (payload === null || typeof payload !== "object") {
    throw new BillingError("PAYMENT_NOTIFICATION_INVALID", "Invalid payment notification");
  }
  const record = payload as Record<string, unknown>;
  const token = typeof record.Token === "string" ? record.Token : "";
  if (!token || !verifyTBankToken(record, password, token)) {
    throw new BillingError("PAYMENT_NOTIFICATION_INVALID", "Invalid payment notification");
  }
  if (record.TerminalKey !== terminalKey) {
    throw new BillingError("PAYMENT_RECONCILIATION_REQUIRED", "Notification terminal does not match");
  }
  const orderId = stringField(record, "OrderId");
  const paymentId = stringField(record, "PaymentId");
  const status = stringField(record, "Status");
  const amount = numberishField(record, "Amount");
  if (!orderId || !paymentId || !status || amount === null) {
    throw new BillingError("PAYMENT_NOTIFICATION_INVALID", "Notification is missing required fields");
  }
  const method = normalizeSignedPaymentMethod(record);
  return {
    terminalKey,
    orderId,
    paymentId,
    status,
    success: record.Success === true || record.Success === "true",
    amountMicroRub: kopecksToMicroRub(amount),
    errorCode: typeof record.ErrorCode === "string" ? record.ErrorCode : undefined,
    rebillId: typeof record.RebillId === "string" ? record.RebillId : undefined,
    paymentMethod: method.paymentMethod,
    rawProviderSource: method.raw ?? undefined,
  };
}

function parseInitResponse(payload: unknown): {
  success: boolean;
  paymentId?: string;
  paymentUrl?: string;
  status?: string;
} {
  if (payload === null || typeof payload !== "object") {
    return { success: false };
  }
  const record = payload as Record<string, unknown>;
  return {
    success: record.Success === true,
    paymentId: record.PaymentId !== undefined ? String(record.PaymentId) : undefined,
    paymentUrl: typeof record.PaymentURL === "string" ? record.PaymentURL : undefined,
    status: typeof record.Status === "string" ? record.Status : undefined,
  };
}

function parseStateResponse(payload: unknown): ProviderPaymentState {
  if (payload === null || typeof payload !== "object") {
    throw new BillingError("PAYMENT_PROVIDER_UNAVAILABLE", "Invalid provider status payload");
  }
  const record = payload as Record<string, unknown>;
  const amount = numberishField(record, "Amount");
  const orderId = stringField(record, "OrderId");
  const paymentId = stringField(record, "PaymentId");
  const status = stringField(record, "Status");
  if (!orderId || !paymentId || !status || amount === null) {
    throw new BillingError("PAYMENT_PROVIDER_UNAVAILABLE", "Provider status is incomplete");
  }
  const method = normalizePaymentMethod({ getStateSource: sourceFromParams(record) });
  return {
    orderId,
    providerPaymentId: paymentId,
    providerStatus: status,
    amountMicroRub: kopecksToMicroRub(amount),
    success: record.Success === true,
    paymentMethod: method.paymentMethod,
    rawProviderSource: method.raw ?? undefined,
  };
}

function parseCheckOrder(payload: unknown): HostedCheckoutResult | null {
  if (payload === null || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const payments = record.Payments;
  if (!Array.isArray(payments) || payments.length === 0 || typeof payments[0] !== "object") {
    return null;
  }
  const first = payments[0] as Record<string, unknown>;
  const paymentId = first.PaymentId !== undefined ? String(first.PaymentId) : undefined;
  if (!paymentId) {
    return null;
  }
  return {
    providerPaymentId: paymentId,
    paymentUrl: typeof record.PaymentURL === "string" ? record.PaymentURL : "",
    providerStatus: typeof first.Status === "string" ? first.Status : "NEW",
  };
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function numberishField(record: Record<string, unknown>, key: string): bigint | null {
  const value = record[key];
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  return null;
}

function normalizeSignedPaymentMethod(record: Record<string, unknown>) {
  const pan = record.Pan;
  const signedPanPresent = typeof pan === "string" && pan.length > 0;
  const signedSource = typeof record.Source === "string" ? record.Source : null;
  return normalizePaymentMethod({ signedPanPresent, signedSource });
}

function sourceFromParams(record: Record<string, unknown>): string | null {
  const params = record.Params;
  if (!Array.isArray(params)) {
    return null;
  }
  for (const item of params) {
    if (item !== null && typeof item === "object" && "Key" in item && "Value" in item) {
      const key = (item as { Key: unknown }).Key;
      const value = (item as { Value: unknown }).Value;
      if (key === "Source" && typeof value === "string") {
        return value;
      }
    }
  }
  return null;
}

export function isConfirmedProviderStatus(status: string): boolean {
  return classifyTBankStatus(status) === "confirmed";
}
