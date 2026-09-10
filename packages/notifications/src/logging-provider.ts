import { hmacSha256Hex } from "@vimla/shared";
import type { EmailMessage, EmailProvider, EmailSendResult, SmsMessage, SmsProvider } from "./types.js";

export class LoggingEmailProvider implements EmailProvider {
  readonly name = "logging";

  constructor(private readonly secret: string) {}

  async sendEmail(message: EmailMessage): Promise<EmailSendResult> {
    process.stderr.write(
      `notification email queued template=${message.templateId} to=${hmacSha256Hex(this.secret, message.to)}\n`,
    );
    return {};
  }
}

export class LoggingSmsProvider implements SmsProvider {
  readonly name = "logging";

  constructor(private readonly secret: string) {}

  async sendSms(message: SmsMessage): Promise<void> {
    process.stderr.write(
      `notification sms queued template=${message.templateId} to=${hmacSha256Hex(this.secret, message.to)}\n`,
    );
  }
}
