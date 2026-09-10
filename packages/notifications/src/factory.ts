import { createTransport } from "nodemailer";
import { DEFAULT_VIMLA_LOCALE, type VimlaLocale } from "@vimla/shared";
import { HttpSmsProvider } from "./http-sms-provider.js";
import { memoryNotificationInbox } from "./memory-inbox.js";
import { MemoryEmailProvider, MemorySmsProvider } from "./memory-provider.js";
import { NotificationService, type NotificationServiceOptions } from "./service.js";
import { SmtpEmailProvider, type SmtpEmailConfig } from "./smtp-email-provider.js";
import type { NotificationMetrics } from "./metrics.js";
import type {
  NotificationAbuseLimits,
  NotificationCoordinationStore,
  SanitizedNotificationEvent,
} from "./types.js";

export type AppNotificationEnv = "local" | "test" | "staging" | "production";

export type EmailAdapterConfig =
  | { kind: "memory" }
  | ({ kind: "smtp" } & SmtpEmailConfig);

export type SmsAdapterConfig =
  | { kind: "memory" }
  | { kind: "http"; url: string; authorization: string; timeoutMs?: number };

export function isDevNotificationInboxEnabled(appEnv: AppNotificationEnv): boolean {
  return appEnv === "local" || appEnv === "test";
}

export function createNotificationService(input: {
  appEnv: AppNotificationEnv;
  secret: string;
  defaultLocale?: VimlaLocale;
  email: EmailAdapterConfig;
  sms: SmsAdapterConfig;
  store?: NotificationCoordinationStore;
  limits?: Partial<NotificationAbuseLimits>;
  metrics?: NotificationMetrics;
  onEvent?: (event: SanitizedNotificationEvent) => void;
  retryBackoffMs?: number;
  failClosed?: boolean;
  requiredChannels?: { email: boolean; sms: boolean };
}): NotificationService {
  assertProductionAdapters(
    input.appEnv,
    input.email.kind,
    input.sms.kind,
    input.requiredChannels ?? { email: true, sms: true },
  );

  const defaultLocale = input.defaultLocale ?? DEFAULT_VIMLA_LOCALE;
  const options: NotificationServiceOptions = {
    email:
      input.email.kind === "memory"
        ? new MemoryEmailProvider(memoryNotificationInbox)
        : new SmtpEmailProvider(input.email, createSmtpTransport(input.email)),
    sms:
      input.sms.kind === "memory"
        ? new MemorySmsProvider(memoryNotificationInbox)
        : new HttpSmsProvider({
            url: input.sms.url,
            authorization: input.sms.authorization,
            timeoutMs: input.sms.timeoutMs,
          }),
    defaultLocale,
    secret: input.secret,
    store: input.store,
    limits: input.limits,
    metrics: input.metrics,
    onEvent: input.onEvent,
    retryBackoffMs: input.retryBackoffMs,
    failClosed: input.failClosed ?? (input.appEnv === "staging" || input.appEnv === "production"),
  };

  return new NotificationService(options);
}

function assertProductionAdapters(
  appEnv: AppNotificationEnv,
  emailKind: EmailAdapterConfig["kind"],
  smsKind: SmsAdapterConfig["kind"],
  required: { email: boolean; sms: boolean },
): void {
  if (appEnv !== "staging" && appEnv !== "production") {
    return;
  }
  if (required.email && emailKind !== "smtp") {
    throw new Error(
      "EMAIL_PROVIDER must be smtp in staging/production; memory and logging adapters cannot deliver mail",
    );
  }
  if (required.sms && smsKind !== "http") {
    throw new Error(
      "SMS_PROVIDER must be http in staging/production; memory and logging adapters cannot deliver SMS",
    );
  }
}

function createSmtpTransport(config: SmtpEmailConfig) {
  return createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password,
    },
    connectionTimeout: 10_000,
    socketTimeout: 10_000,
  });
}
