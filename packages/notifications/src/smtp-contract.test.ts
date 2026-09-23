import { createTransport } from "nodemailer";
import { describe, expect, it } from "vitest";
import { SmtpEmailProvider } from "./smtp-email-provider.js";

describe("real Nodemailer message contract", () => {
  it("composes the allowlisted application message without accepting raw content", async () => {
    const transport = createTransport({ streamTransport: true, buffer: true });
    let mime = "";
    const provider = new SmtpEmailProvider(
      {
        host: "localhost",
        port: 25,
        secure: false,
        user: "test",
        password: "test",
        from: "sender@example.test",
      },
      {
        sendMail: async (message) => {
          const result = await transport.sendMail(message);
          mime = result.message.toString();
          return result;
        },
      },
    );
    const message = {
      to: "recipient@example.test",
      templateId: "emailVerificationOtp" as const,
      locale: "en" as const,
      subject: "Verify account",
      text: "Code: 123456",
      raw: "UNTRUSTED RAW OVERRIDE",
    };
    const result = await provider.sendEmail(message);
    expect(result.providerMessageId).toBeTruthy();
    expect(mime).toContain("To: recipient@example.test");
    expect(mime).toContain("Subject: Verify account");
    expect(mime).toContain("Code: 123456");
    expect(mime).not.toContain("UNTRUSTED RAW OVERRIDE");
  });

  it("rejects message-level raw file and URL access when disabled", async () => {
    const transport = createTransport({ streamTransport: true, buffer: true });
    await expect(
      transport.sendMail({
        raw: { path: "/vimla-test-file-that-must-not-be-opened" },
        disableFileAccess: true,
      }),
    ).rejects.toThrow(/File access rejected/);
    await expect(
      transport.sendMail({
        raw: { href: "http://127.0.0.1:1/must-not-be-fetched" },
        disableUrlAccess: true,
      }),
    ).rejects.toThrow(/Url access rejected/);
  });
});
