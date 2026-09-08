import { describe, expect, it } from "vitest";
import { MemoryNotificationInbox } from "./memory-inbox.js";
import { MemoryEmailProvider, MemorySmsProvider } from "./memory-provider.js";
import { NotificationService } from "./service.js";
import { renderEmailTemplate, renderSmsTemplate } from "./templates.js";

describe("notification templates", () => {
  it("renders RU and EN verification copy without embedding secrets besides the OTP", () => {
    const ru = renderEmailTemplate("emailVerificationOtp", "ru", { otp: "123456" });
    const en = renderEmailTemplate("emailVerificationOtp", "en", { otp: "123456" });
    expect(ru.subject).toContain("Vimla");
    expect(ru.text).toContain("123456");
    expect(en.text).toContain("123456");
    expect(renderSmsTemplate("phoneVerificationOtp", "ru", "654321")).toContain("654321");
  });
});

describe("NotificationService", () => {
  it("queues email and SMS through replaceable providers", async () => {
    const inbox = new MemoryNotificationInbox();
    const service = new NotificationService({
      email: new MemoryEmailProvider(inbox),
      sms: new MemorySmsProvider(inbox),
      defaultLocale: "ru",
      secret: "test-notification-secret-value",
      retryBackoffMs: 0,
    });

    service.queueEmail({
      to: "ada@example.com",
      templateId: "emailVerificationOtp",
      otp: "111222",
    });
    service.queueSms({
      to: "+79991234567",
      templateId: "phoneVerificationOtp",
      otp: "333444",
    });

    await service.flush();
    expect(inbox.latestOtp("email", "ada@example.com")).toBe("111222");
    expect(inbox.latestOtp("sms", "+79991234567")).toBe("333444");
  });
});

describe("logging notification providers", () => {
  it("does not write OTP, reset URLs or raw email/phone to logs", async () => {
    const { LoggingEmailProvider, LoggingSmsProvider } = await import("./logging-provider.js");
    const chunks: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write;

    try {
      const email = new LoggingEmailProvider("test-secret-value");
      const sms = new LoggingSmsProvider("test-secret-value");
      await email.sendEmail({
        to: "secret.user@example.com",
        templateId: "emailVerificationOtp",
        locale: "ru",
        subject: "code",
        text: "OTP 654321",
      });
      await sms.sendSms({
        to: "+79991234567",
        templateId: "phoneVerificationOtp",
        locale: "ru",
        text: "654321",
      });
    } finally {
      process.stderr.write = originalWrite;
    }

    const serialized = chunks.join("");
    expect(serialized).not.toContain("654321");
    expect(serialized).not.toContain("secret.user@example.com");
    expect(serialized).not.toContain("+79991234567");
  });
});
