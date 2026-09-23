import { createTransport } from "nodemailer";
import { DEFAULT_VIMLA_LOCALE, type VimlaLocale } from "@vimla/shared";
import { memoryNotificationInbox } from "./memory-inbox.js";
import { MemoryEmailProvider } from "./memory-provider.js";
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

export function isDevNotificationInboxEnabled(appEnv: AppNotificationEnv): boolean {
  return appEnv === "local" || appEnv === "test";
}

export function createNotificationService(input: {
  appEnv: AppNotificationEnv;
  secret: string;
  defaultLocale?: VimlaLocale;
  email: EmailAdapterConfig;
  store?: NotificationCoordinationStore;
  limits?: Partial<NotificationAbuseLimits>;
  metrics?: NotificationMetrics;
  onEvent?: (event: SanitizedNotificationEvent) => void;
  retryBackoffMs?: number;
  failClosed?: boolean;
}): NotificationService {
  assertProductionAdapters(input.appEnv, input.email.kind);

  const defaultLocale = input.defaultLocale ?? DEFAULT_VIMLA_LOCALE;
  const options: NotificationServiceOptions = {
    email:
      input.email.kind === "memory"
        ? new MemoryEmailProvider(memoryNotificationInbox)
        : new SmtpEmailProvider(input.email, createSmtpTransport(input.email)),
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
): void {
  if (appEnv !== "staging" && appEnv !== "production") {
    return;
  }
  if (emailKind !== "smtp") {
    throw new Error(
      "EMAIL_PROVIDER must be smtp in staging/production; memory and logging adapters cannot deliver mail",
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
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}
