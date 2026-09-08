import type { SmsMessage, SmsProvider } from "./types.js";
import { NotificationDeliveryError } from "./errors.js";

export interface HttpSmsConfig {
  url: string;
  authorization: string;
  timeoutMs?: number;
}

export class HttpSmsProvider implements SmsProvider {
  readonly name = "http";

  constructor(
    private readonly config: HttpSmsConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async sendSms(message: SmsMessage): Promise<void> {
    const timeoutMs = this.config.timeoutMs ?? 10_000;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await this.fetchImpl(this.config.url, {
        method: "POST",
        headers: {
          authorization: this.config.authorization,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          to: message.to,
          text: message.text,
          templateId: message.templateId,
        }),
        signal: controller.signal,
      });

      if (response.status >= 500) {
        throw new NotificationDeliveryError("ambiguous", "SMS gateway server error");
      }
      if (response.status >= 400) {
        throw new NotificationDeliveryError("rejected", "SMS gateway rejected the message");
      }
      if (!response.ok) {
        throw new NotificationDeliveryError("ambiguous", "SMS gateway returned an unexpected status");
      }
    } catch (error: unknown) {
      if (error instanceof NotificationDeliveryError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new NotificationDeliveryError("timeout", "SMS gateway timeout");
      }
      throw new NotificationDeliveryError("network", "SMS gateway network failure");
    } finally {
      clearTimeout(timer);
    }
  }
}
