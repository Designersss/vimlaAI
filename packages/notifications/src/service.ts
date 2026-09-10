import { randomUUID } from "node:crypto";
import { hmacSha256Hex, type VimlaLocale } from "@vimla/shared";
import { renderEmailTemplate } from "./templates.js";
import {
  NotificationAbuseError,
  deliveryErrorCategory,
  isNotificationAbuseError,
} from "./errors.js";
import { NotificationMetrics } from "./metrics.js";
import { MemoryNotificationStore } from "./store.js";
import type {
  EmailProvider,
  EmailTemplateId,
  NotificationAbuseLimits,
  NotificationCoordinationStore,
  SanitizedNotificationEvent,
} from "./types.js";

const DEFAULT_LIMITS: NotificationAbuseLimits = {
  emailRetryMax: 2,
  emailPerDestPerHour: 8,
  emailPerIpPerHour: 20,
  emailGlobalPerMinute: 40,
};

const IDEMPOTENCY_TTL_SECONDS = 86_400;
const HOUR_SECONDS = 3_600;
const MINUTE_SECONDS = 60;

export interface NotificationServiceOptions {
  email: EmailProvider;
  defaultLocale: VimlaLocale;
  secret: string;
  store?: NotificationCoordinationStore;
  limits?: Partial<NotificationAbuseLimits>;
  metrics?: NotificationMetrics;
  onEvent?: (event: SanitizedNotificationEvent) => void;
  retryBackoffMs?: number;
  now?: () => Date;
  failClosed?: boolean;
}

export class NotificationService {
  readonly metrics: NotificationMetrics;
  private readonly limits: NotificationAbuseLimits;
  private readonly store: NotificationCoordinationStore;
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly options: NotificationServiceOptions) {
    this.metrics = options.metrics ?? new NotificationMetrics();
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.store = options.store ?? new MemoryNotificationStore();
  }

  async consumeBudget(input: {
    channel: "email";
    to: string;
    ip?: string;
    userId?: string;
  }): Promise<void> {
    const now = this.options.now?.() ?? new Date();
    const hour = utcHourBucket(now);
    const minute = utcMinuteBucket(now);
    const destHash = this.destinationHash("email", input.to);
    const ipKey = this.destinationHash("ip", input.ip && input.ip.length > 0 ? input.ip : "unknown");

    try {
      await this.enforce(
        `notify:email:dest:${destHash}:h${hour}`,
        HOUR_SECONDS,
        this.limits.emailPerDestPerHour,
      );
      await this.enforce(
        `notify:email:ip:${ipKey}:h${hour}`,
        HOUR_SECONDS,
        this.limits.emailPerIpPerHour,
      );
      await this.enforce(
        `notify:email:global:m${minute}`,
        MINUTE_SECONDS,
        this.limits.emailGlobalPerMinute,
      );
    } catch (error: unknown) {
      if (isNotificationAbuseError(error)) {
        throw error;
      }
      if (this.options.failClosed) {
        throw new NotificationAbuseError();
      }
    }
  }

  queueEmail(input: {
    to: string;
    templateId: EmailTemplateId;
    locale?: VimlaLocale;
    otp?: string;
    resetUrl?: string;
    notificationId?: string;
    ip?: string;
    userId?: string;
    budgetConsumed?: boolean;
  }): void {
    if (input.templateId === "passwordReset") {
      this.metrics.recordPasswordResetRequest();
    }
    if (input.templateId === "emailVerificationOtp" || input.templateId === "changeEmailOtp") {
      this.metrics.recordOtpResend();
    }
    this.track(
      this.deliverEmail({
        to: input.to,
        templateId: input.templateId,
        locale: input.locale ?? this.options.defaultLocale,
        otp: input.otp,
        resetUrl: input.resetUrl,
        notificationId: input.notificationId ?? randomUUID(),
        ip: input.ip,
        userId: input.userId,
        budgetConsumed: input.budgetConsumed === true,
      }),
    );
  }

  async flush(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  async sendEmailOnce(input: {
    to: string;
    templateId: EmailTemplateId;
    locale?: VimlaLocale;
    notificationId: string;
    ip?: string;
    userId?: string;
    otp?: string;
    resetUrl?: string;
    reminderTitle?: string;
    scheduledLabel?: string;
    openUrl?: string;
    consumeBudget?: boolean;
  }): Promise<{ duplicate: boolean; providerMessageId?: string }> {
    if (input.consumeBudget !== false) {
      await this.consumeBudget({
        channel: "email",
        to: input.to,
        ip: input.ip,
        userId: input.userId,
      });
    }
    const claimed = await this.claimDispatch(input.notificationId);
    if (!claimed) {
      return { duplicate: true };
    }

    const locale = input.locale ?? this.options.defaultLocale;
    const rendered = renderEmailTemplate(input.templateId, locale, {
      otp: input.otp,
      resetUrl: input.resetUrl,
      reminderTitle: input.reminderTitle,
      scheduledLabel: input.scheduledLabel,
      openUrl: input.openUrl,
    });
    try {
      const result = await this.options.email.sendEmail({
        to: input.to,
        templateId: input.templateId,
        locale,
        subject: rendered.subject,
        text: rendered.text,
      });
      this.metrics.recordDelivery("email", true);
      return { duplicate: false, providerMessageId: result.providerMessageId };
    } catch (error: unknown) {
      await this.releaseDispatch(input.notificationId);
      this.metrics.recordDelivery("email", false);
      throw error;
    }
  }

  private track(job: Promise<void>): void {
    this.pending.add(job);
    void job.finally(() => {
      this.pending.delete(job);
    });
  }

  private async deliverEmail(input: {
    to: string;
    templateId: EmailTemplateId;
    locale: VimlaLocale;
    otp?: string;
    resetUrl?: string;
    notificationId: string;
    ip?: string;
    userId?: string;
    budgetConsumed: boolean;
  }): Promise<void> {
    const started = Date.now();
    const destinationHash = this.destinationHash("email", input.to);
    let retryCount = 0;
    try {
      if (!input.budgetConsumed) {
        await this.consumeBudget({
          channel: "email",
          to: input.to,
          ip: input.ip,
          userId: input.userId,
        });
      }
      const claimed = await this.claimDispatch(input.notificationId);
      if (!claimed) {
        this.emit({
          channel: "email",
          templateId: input.templateId,
          provider: this.options.email.name,
          success: true,
          latencyMs: Date.now() - started,
          errorCategory: "duplicate",
          retryCount: 0,
          destinationHash,
          notificationId: input.notificationId,
        });
        return;
      }

      const rendered = renderEmailTemplate(input.templateId, input.locale, {
        otp: input.otp,
        resetUrl: input.resetUrl,
      });
      const maxAttempts = Math.max(1, this.limits.emailRetryMax);
      let lastError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        retryCount = attempt - 1;
        try {
          await this.options.email.sendEmail({
            to: input.to,
            templateId: input.templateId,
            locale: input.locale,
            subject: rendered.subject,
            text: rendered.text,
          });
          this.metrics.recordDelivery("email", true);
          this.emit({
            channel: "email",
            templateId: input.templateId,
            provider: this.options.email.name,
            success: true,
            latencyMs: Date.now() - started,
            retryCount,
            destinationHash,
            notificationId: input.notificationId,
          });
          return;
        } catch (error: unknown) {
          lastError = error;
          const category = deliveryErrorCategory(error);
          const retryable =
            attempt < maxAttempts && (category === "network" || category === "timeout");
          if (!retryable) {
            if (category === "rejected" || category === "network") {
              await this.releaseDispatch(input.notificationId);
            }
            throw error;
          }
          await sleep(this.retryDelay(attempt));
        }
      }
      throw lastError;
    } catch (error: unknown) {
      this.metrics.recordDelivery("email", false);
      this.emit({
        channel: "email",
        templateId: input.templateId,
        provider: this.options.email.name,
        success: false,
        latencyMs: Date.now() - started,
        errorCategory: deliveryErrorCategory(error),
        retryCount,
        destinationHash,
        notificationId: input.notificationId,
      });
    }
  }

  private async claimDispatch(notificationId: string): Promise<boolean> {
    return this.store.setNx(`notify:idemp:${notificationId}`, IDEMPOTENCY_TTL_SECONDS);
  }

  private async releaseDispatch(notificationId: string): Promise<void> {
    await this.store.del(`notify:idemp:${notificationId}`);
  }

  private async enforce(key: string, ttlSeconds: number, max: number): Promise<void> {
    const count = await this.store.incr(key, ttlSeconds);
    if (count > max) {
      throw new NotificationAbuseError();
    }
  }

  private destinationHash(channel: "email" | "ip", to: string): string {
    return hmacSha256Hex(this.options.secret, `${channel}:${to.toLowerCase()}`);
  }

  private retryDelay(attempt: number): number {
    const base = this.options.retryBackoffMs ?? 200;
    return base * 2 ** (attempt - 1);
  }

  private emit(event: SanitizedNotificationEvent): void {
    this.options.onEvent?.(event);
  }
}

function utcHourBucket(now: Date): string {
  return now.toISOString().slice(0, 13).replaceAll(/[-T]/g, "");
}

function utcMinuteBucket(now: Date): string {
  return now.toISOString().slice(0, 16).replaceAll(/[-:T]/g, "");
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
