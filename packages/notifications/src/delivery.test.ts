import { describe, expect, it, vi } from "vitest";
import { NotificationDeliveryError } from "./errors.js";
import { createNotificationService } from "./factory.js";
import { HttpSmsProvider } from "./http-sms-provider.js";
import {
  MemoryNotificationInbox,
  memoryNotificationInbox,
} from "./memory-inbox.js";
import { MemoryEmailProvider, MemorySmsProvider } from "./memory-provider.js";
import { NotificationService } from "./service.js";
import { SmtpEmailProvider } from "./smtp-email-provider.js";
import { MemoryNotificationStore } from "./store.js";

describe("memory notification inbox", () => {
  it("returns the latest matching delivery and treats an empty inbox as null", () => {
    const inbox = new MemoryNotificationInbox();
    expect(inbox.latestMatching()).toBeNull();
    inbox.record({
      channel: "email",
      to: "ada@example.com",
      templateId: "emailVerificationOtp",
      locale: "en",
      sentAt: new Date().toISOString(),
      otp: "111111",
    });
    inbox.record({
      channel: "sms",
      to: "+79990000000",
      templateId: "phoneVerificationOtp",
      locale: "ru",
      sentAt: new Date().toISOString(),
      otp: "222222",
    });
    expect(inbox.latestMatching()?.otp).toBe("222222");
    expect(inbox.latestMatching({ channel: "email" })?.otp).toBe("111111");
    expect(inbox.latestMatching({ to: "+79990000000" })?.otp).toBe("222222");
  });
});

describe("createNotificationService", () => {
  it("refuses memory adapters in production", () => {
    expect(() =>
      createNotificationService({
        appEnv: "production",
        secret: "production-secret-value-32-chars-min",
        email: { kind: "memory" },
        sms: { kind: "memory" },
      }),
    ).toThrow(/smtp/);
  });

  it("writes OTP into the exported memory inbox singleton", async () => {
    memoryNotificationInbox.clear();
    const service = createNotificationService({
      appEnv: "local",
      secret: "local-dev-only-change-me-use-32-chars-min",
      email: { kind: "memory" },
      sms: { kind: "memory" },
    });
    service.queueEmail({
      to: "ada@example.com",
      templateId: "emailVerificationOtp",
      otp: "123456",
      notificationId: "otp-singleton",
      budgetConsumed: true,
    });
    await service.flush();
    expect(memoryNotificationInbox.latestMatching({ to: "ada@example.com" })?.otp).toBe("123456");
    memoryNotificationInbox.clear();
  });
});

describe("notification delivery security", () => {
  it("does not retry SMS and suppresses duplicate notificationIds", async () => {
    const inbox = new MemoryNotificationInbox();
    const sms = new MemorySmsProvider(inbox);
    const sendSms = vi.spyOn(sms, "sendSms");
    const service = new NotificationService({
      email: new MemoryEmailProvider(inbox),
      sms,
      defaultLocale: "en",
      secret: "test-notification-secret-value",
      retryBackoffMs: 0,
      store: new MemoryNotificationStore(),
    });

    service.queueSms({
      to: "+79990000001",
      templateId: "phoneVerificationOtp",
      otp: "111111",
      notificationId: "sms-1",
    });
    service.queueSms({
      to: "+79990000001",
      templateId: "phoneVerificationOtp",
      otp: "111111",
      notificationId: "sms-1",
    });
    await service.flush();
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it("retries email on network failure then succeeds once", async () => {
    let attempts = 0;
    const email = {
      name: "smtp",
        sendEmail: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new NotificationDeliveryError("network", "SMTP network failure");
        }
        return {};
      },
    };
    const inbox = new MemoryNotificationInbox();
    const service = new NotificationService({
      email,
      sms: new MemorySmsProvider(inbox),
      defaultLocale: "en",
      secret: "test-notification-secret-value",
      retryBackoffMs: 0,
      limits: { emailRetryMax: 2 },
    });
    service.queueEmail({
      to: "ada@example.com",
      templateId: "securityPasswordChanged",
      notificationId: "email-retry",
    });
    await service.flush();
    expect(attempts).toBe(2);
    expect(service.metrics.snapshot().emailSent).toBe(1);
  });

  it("sendEmailOnce awaits a single attempt and returns provider-neutral success", async () => {
    const inbox = new MemoryNotificationInbox();
    const service = new NotificationService({
      email: new MemoryEmailProvider(inbox),
      sms: new MemorySmsProvider(inbox),
      defaultLocale: "en",
      secret: "test-notification-secret-value",
    });
    const result = await service.sendEmailOnce({
      to: "ada@example.com",
      templateId: "reminderDue",
      notificationId: "reminder-1",
      reminderTitle: "Call dentist",
      scheduledLabel: "Sep 10, 2026, 3:00 PM",
      consumeBudget: false,
    });
    expect(result.duplicate).toBe(false);
    expect(inbox.latestMatching({ to: "ada@example.com" })?.templateId).toBe("reminderDue");
  });

  it("enforces rolling SMS destination limits", async () => {
    const inbox = new MemoryNotificationInbox();
    const service = new NotificationService({
      email: new MemoryEmailProvider(inbox),
      sms: new MemorySmsProvider(inbox),
      defaultLocale: "en",
      secret: "test-notification-secret-value",
      retryBackoffMs: 0,
      limits: { smsPerPhonePerHour: 1, smsGlobalPerMinute: 100, smsPerIpPerHour: 100 },
    });

    await service.consumeBudget({ channel: "sms", to: "+79990000002", ip: "127.0.0.1" });
    await expect(
      service.consumeBudget({ channel: "sms", to: "+79990000002", ip: "127.0.0.1" }),
    ).rejects.toThrow(/rate limited/);
  });

  it("HMAC-hashes destination and IP in rate-limit keys", async () => {
    const keys: string[] = [];
    const inner = new MemoryNotificationStore();
    const store = {
      incr: async (key: string, ttlSeconds: number) => {
        keys.push(key);
        return inner.incr(key, ttlSeconds);
      },
      setNx: (key: string, ttlSeconds: number) => inner.setNx(key, ttlSeconds),
      del: (key: string) => inner.del(key),
    };
    const service = new NotificationService({
      email: new MemoryEmailProvider(new MemoryNotificationInbox()),
      sms: new MemorySmsProvider(new MemoryNotificationInbox()),
      defaultLocale: "en",
      secret: "test-notification-secret-value",
      store,
    });
    await service.consumeBudget({
      channel: "email",
      to: "ada@example.com",
      ip: "203.0.113.10",
    });
    const joined = keys.join(" ");
    expect(joined).not.toContain("ada@example.com");
    expect(joined).not.toContain("203.0.113.10");
    expect(keys.some((key) => key.startsWith("notify:email:dest:"))).toBe(true);
    expect(keys.some((key) => key.startsWith("notify:email:ip:"))).toBe(true);
  });
});

describe("vendor adapters", () => {
  it("SMTP adapter never includes OTP in thrown errors", async () => {
    const provider = new SmtpEmailProvider(
      {
        host: "smtp.example.com",
        port: 587,
        secure: false,
        user: "vimla",
        password: "secret",
        from: "noreply@vimla.example",
      },
      {
        sendMail: async () => {
          throw Object.assign(new Error("550 user unknown OTP 999111"), { responseCode: 550 });
        },
      },
    );

    await expect(
      provider.sendEmail({
        to: "ada@example.com",
        templateId: "emailVerificationOtp",
        locale: "en",
        subject: "code",
        text: "999111",
      }),
    ).rejects.toMatchObject({ category: "rejected", message: "SMTP rejected the message" });
  });

  it("HTTP SMS adapter posts to the configured gateway without logging", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));
    const provider = new HttpSmsProvider(
      { url: "https://sms.example.com/send", authorization: "Bearer token" },
      fetchImpl,
    );
    await provider.sendSms({
      to: "+79990000003",
      templateId: "phoneVerificationOtp",
      locale: "ru",
      text: "Код Vimla: 222333. Действует 5 минут.",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ authorization: "Bearer token" });
    expect(String(init?.body)).toContain("222333");
    expect(String(init?.body)).toContain("+79990000003");
  });
});
