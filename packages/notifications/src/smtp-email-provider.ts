import type { EmailMessage, EmailProvider } from "./types.js";
import { NotificationDeliveryError } from "./errors.js";

export interface SmtpEmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  replyTo?: string;
}

export interface SmtpTransport {
  sendMail(message: {
    from: string;
    to: string;
    replyTo?: string;
    subject: string;
    text: string;
  }): Promise<unknown>;
}

export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";

  constructor(
    private readonly config: SmtpEmailConfig,
    private readonly transport: SmtpTransport,
  ) {}

  async sendEmail(message: EmailMessage): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.config.from,
        to: message.to,
        replyTo: this.config.replyTo,
        subject: message.subject,
        text: message.text,
      });
    } catch (error: unknown) {
      throw mapSmtpError(error);
    }
  }
}

function mapSmtpError(error: unknown): NotificationDeliveryError {
  const code =
    error !== null && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  const responseCode =
    error !== null && typeof error === "object" && "responseCode" in error
      ? Number(error.responseCode)
      : undefined;

  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
    return new NotificationDeliveryError("timeout", "SMTP timeout");
  }
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return new NotificationDeliveryError("network", "SMTP network failure");
  }
  if (responseCode !== undefined && responseCode >= 550) {
    return new NotificationDeliveryError("rejected", "SMTP rejected the message");
  }
  if (responseCode !== undefined && responseCode >= 500) {
    return new NotificationDeliveryError("ambiguous", "SMTP server error");
  }
  if (responseCode !== undefined && responseCode >= 400) {
    return new NotificationDeliveryError("rejected", "SMTP rejected the message");
  }
  return new NotificationDeliveryError("ambiguous", "SMTP delivery failed");
}
