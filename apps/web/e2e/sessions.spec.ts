import { expect, test } from "@playwright/test";
import { signUp, uniqueEmail, verifyEmail } from "./helpers";

test.describe("sessions", () => {
  test("revoking other sessions blocks the second browser", async ({ browser, request }) => {
    const email = uniqueEmail("e2e-sess");
    const password = "correct-horse-battery";
    const first = await browser.newContext();
    const second = await browser.newContext();
    const pageA = await first.newPage();
    const pageB = await second.newPage();

    try {
      await signUp(pageA, { name: "Ada", email, password });
      await verifyEmail(pageA, request, email);

      await pageB.goto("/sign-in");
      await pageB.getByLabel(/email/i).fill(email);
      await pageB.locator("#auth-password").fill(password);
      await pageB.getByRole("button", { name: /войти|sign in/i }).click();
      await expect(pageB).toHaveURL(/\/app/);

      await pageA.goto("/settings/security");
      await pageA.getByRole("button", { name: /завершить остальные|revoke others|sign out other/i }).click();
      await pageB.goto("/app");
      await expect(pageB).toHaveURL(/sign-in|verify-email/);
    } finally {
      await first.close();
      await second.close();
    }
  });
});
