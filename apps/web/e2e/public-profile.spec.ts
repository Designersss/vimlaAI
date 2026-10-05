import { expect, test } from "@playwright/test";
import {
  signUp,
  uniqueEmail,
  uniqueHandle,
  verifyEmail,
} from "./helpers";

test.describe("Public profile", () => {
  test("supports profile editing, discovery and starting Direct Chat without email", async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const password = "correct-horse-battery";
    const bobEmail = uniqueEmail("profile-bob");
    const bobHandle = uniqueHandle("profilebob");
    const aliceEmail = uniqueEmail("profile-alice");
    const aliceHandle = uniqueHandle("profilealice");

    const bobContext = await browser.newContext();
    const aliceContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    const alicePage = await aliceContext.newPage();

    await signUp(
      bobPage,
      {
        name: "Profile Bob",
        email: bobEmail,
        password,
        handle: bobHandle,
      },
      "en",
    );
    await verifyEmail(bobPage, request, bobEmail);

    await bobPage.goto("/app/people");
    await expect(
      bobPage.getByRole("heading", { name: "Find people" }),
    ).toBeVisible();
    await bobPage.getByRole("link", { name: "My profile" }).click();
    await expect(bobPage).toHaveURL(
      new RegExp(`/app/profile/${bobHandle}$`),
    );
    await bobPage.getByRole("button", { name: "Edit profile" }).click();
    await bobPage.getByLabel("Display name").fill("Bobby Profile");
    await bobPage.getByLabel("Status").fill("Available for a chat");
    await bobPage.getByLabel("Bio").fill("Public bio visible to discoverable people.");
    await bobPage.getByRole("button", { name: "Save" }).click();
    await expect(bobPage.getByText("Profile updated.")).toBeVisible();
    await expect(
      bobPage.getByRole("heading", { name: "Bobby Profile" }),
    ).toBeVisible();

    await signUp(
      alicePage,
      {
        name: "Profile Alice",
        email: aliceEmail,
        password,
        handle: aliceHandle,
      },
      "en",
    );
    await verifyEmail(alicePage, request, aliceEmail);

    await alicePage.goto("/app");
    await alicePage
      .getByRole("button", { name: "New direct chat" })
      .click();
    const startDirect = alicePage.getByRole("button", {
      name: "Start chat",
    });
    await expect(startDirect).toBeDisabled();
    await alicePage.getByPlaceholder("@handle").fill(`@${bobHandle}`);
    await expect(startDirect).toBeDisabled();
    const bobDirectResult = alicePage
      .getByTestId("people-search-results")
      .getByRole("button")
      .filter({ hasText: `@${bobHandle}` });
    await expect(bobDirectResult).toBeVisible({ timeout: 20_000 });
    await bobDirectResult.click();
    await expect(startDirect).toBeEnabled();
    await alicePage.getByRole("button", { name: "Close" }).click();

    await alicePage.goto("/app/people");
    await alicePage.getByPlaceholder("Search people").fill(`@${bobHandle}`);
    const results = alicePage.getByTestId("people-directory-results");
    await expect(results).toContainText("Bobby Profile");
    await expect(results).toContainText(`@${bobHandle}`);
    await expect(results).not.toContainText(bobEmail);

    await results
      .getByRole("link")
      .filter({ hasText: `@${bobHandle}` })
      .click();
    await expect(alicePage).toHaveURL(
      new RegExp(`/app/profile/${bobHandle}$`),
    );
    const profile = alicePage.getByTestId("public-profile-screen");
    await expect(profile).toContainText("Bobby Profile");
    await expect(profile).toContainText(`@${bobHandle}`);
    await expect(profile).toContainText("Available for a chat");
    await expect(profile).toContainText("Public bio visible to discoverable people.");
    await expect(profile).not.toContainText(bobEmail);

    await alicePage.setViewportSize({ width: 390, height: 844 });
    await expect(profile).toBeVisible();
    expect(
      await alicePage.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);

    await alicePage.getByRole("button", { name: "Start chat" }).click();
    await expect(alicePage).toHaveURL(/\/app\/direct\/[0-9a-f-]+/i, {
      timeout: 30_000,
    });
    await expect(
      alicePage.getByPlaceholder("Message this person"),
    ).toBeVisible({ timeout: 30_000 });

    const directShell = alicePage.getByTestId(
      "direct-chat-shell",
    );
    await expect(directShell).toContainText(
      `@${bobHandle}`,
    );

    await alicePage.goto("/app");
    await expect(
      alicePage
        .getByTestId("direct-conversation-row")
        .filter({ hasText: `@${bobHandle}` }),
    ).toBeVisible({ timeout: 20_000 });

    await bobContext.close();
    await aliceContext.close();
  });
});
