import type { EmailMessage, EmailProvider, EmailSendResult } from "./types.js";
import {
  memoryNotificationInbox,
  type MemoryNotificationInbox,
} from "./memory-inbox.js";

export class MemoryEmailProvider implements EmailProvider {
  readonly name = "memory";

  constructor(private readonly inbox: MemoryNotificationInbox = memoryNotificationInbox) {}

  async sendEmail(message: EmailMessage): Promise<EmailSendResult> {
    this.inbox.record({
      channel: "email",
      to: message.to,
      templateId: message.templateId,
      locale: message.locale,
      sentAt: new Date().toISOString(),
      otp: extractOtp(message.text),
      resetUrl: extractResetUrl(message.text),
    });
    return {};
  }
}

function extractOtp(text: string): string | undefined {
  const match = text.match(/\b(\d{6})\b/);
  return match?.[1];
}

function extractResetUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/\S+/);
  return match?.[0];
}
