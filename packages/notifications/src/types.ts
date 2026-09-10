import type { VimlaLocale } from "@vimla/shared";

export type EmailTemplateId =
  | "emailVerificationOtp"
  | "passwordReset"
  | "securityPasswordChanged"
  | "changeEmailOtp"
  | "reminderDue";

export type SmsTemplateId = "phoneVerificationOtp";

export interface EmailMessage {
  to: string;
  templateId: EmailTemplateId;
  locale: VimlaLocale;
  subject: string;
  text: string;
}

export interface SmsMessage {
  to: string;
  templateId: SmsTemplateId;
  locale: VimlaLocale;
  text: string;
}

export interface EmailProvider {
  readonly name: string;
  sendEmail(message: EmailMessage): Promise<EmailSendResult>;
}

export interface EmailSendResult {
  providerMessageId?: string;
}

export interface SmsProvider {
  readonly name: string;
  sendSms(message: SmsMessage): Promise<void>;
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
  smsRetryMax: number;
  emailPerDestPerHour: number;
  emailPerIpPerHour: number;
  emailGlobalPerMinute: number;
  smsPerPhonePerHour: number;
  smsPerAccountPerHour: number;
  smsPerIpPerHour: number;
  smsGlobalPerMinute: number;
}

export interface SanitizedNotificationEvent {
  channel: "email" | "sms";
  templateId: EmailTemplateId | SmsTemplateId;
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
  channel: "email" | "sms";
  to: string;
  templateId: EmailTemplateId | SmsTemplateId;
  locale: VimlaLocale;
  sentAt: string;
  otp?: string;
  resetUrl?: string;
}

export interface NotificationInbox {
  record(delivery: NotificationDelivery): void;
  latest(channel: "email" | "sms", to: string): NotificationDelivery | null;
  latestOtp(channel: "email" | "sms", to: string): string | null;
  clear(): void;
}
