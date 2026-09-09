import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import ru from "../../messages/ru.json";
import { collectKeys } from "./message-keys";

describe("i18n dictionaries", () => {
  it("keeps RU and EN keys in sync for auth, chat, usage and errors", () => {
    const ruKeys = collectKeys(ru).sort();
    const enKeys = collectKeys(en).sort();
    expect(ruKeys).toEqual(enKeys);
    expect(ruKeys.some((key) => key.startsWith("auth."))).toBe(true);
    expect(ruKeys.some((key) => key.startsWith("chat."))).toBe(true);
    expect(ruKeys.some((key) => key.startsWith("errors."))).toBe(true);
    expect(ruKeys).toContain("auth.signIn");
    expect(ruKeys).toContain("auth.verifyEmail.title");
    expect(ruKeys).toContain("auth.forgot.title");
    expect(ruKeys).toContain("auth.reset.title");
    expect(ruKeys).toContain("settings.securityTitle");
    expect(ruKeys).toContain("billing.title");
    expect(ruKeys).toContain("billing.activeUntil");
    expect(ruKeys).toContain("billing.topupNeverExpires");
    expect(ruKeys).toContain("appearance.theme");
    expect(ruKeys).toContain("nav.work");
    expect(ruKeys).toContain("work.today");
    expect(ruKeys).toContain("work.noDelivery");
    expect(JSON.stringify(en)).not.toMatch(/Acme|Sarah Chen|62% used of 1,240/i);
    expect(JSON.stringify(ru)).not.toMatch(/Acme|Sarah Chen/);
    expect(ruKeys).toContain("validation.passwordMin");
  });
});
