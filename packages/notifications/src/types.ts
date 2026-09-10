import type { VimlaLocale } from "@vimla/shared";

export type EmailTemplateId =
  | "emailVerificationOtp"
  | "passwordReset"
  | "securityPasswordChanged"
  | "changeEmailOtp"
  | "reminderDue";

export interface EmailMessage {
  to: string;
  templateId: EmailTemplateId;
  locale: VimlaLocale;
  subject: string;
  text: string;
}

export interface EmailProvider {
  readonly name: string;
  sendEmail(message: EmailMessage): Promise<EmailSendResult>;
}

export interface EmailSendResult {
  providerMessageId?: string;
}

export type NotificationErrorCategory =
  | "timeout"
  | "rejected"
  | "ambiguous"
  | "network"
  | "config"
  | "abuse"
  | "duplicate";

export interface NotificationAbuseLimits {
  emailRetryMax: number;
  emailPerDestPerHour: number;
  emailPerIpPerHour: number;
  emailGlobalPerMinute: number;
}

export interface SanitizedNotificationEvent {
  channel: "email";
  templateId: EmailTemplateId;
  provider: string;
  success: boolean;
  latencyMs: number;
  errorCategory?: NotificationErrorCategory;
  retryCount: number;
  destinationHash: string;
  notificationId: string;
}

export interface NotificationCoordinationStore {
  incr(key: string, ttlSeconds: number): Promise<number>;
  setNx(key: string, ttlSeconds: number): Promise<boolean>;
  del(key: string): Promise<void>;
}

export interface NotificationDelivery {
  channel: "email";
  to: string;
  templateId: EmailTemplateId;
  locale: VimlaLocale;
  sentAt: string;
  otp?: string;
  resetUrl?: string;
}

export interface NotificationInbox {
  record(delivery: NotificationDelivery): void;
  latest(channel: "email", to: string): NotificationDelivery | null;
  latestOtp(channel: "email", to: string): string | null;
  clear(): void;
}
