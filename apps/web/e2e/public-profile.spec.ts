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
    await expect(
      profile.getByRole("button", { name: "Report" }),
    ).toBeVisible();
    await expect(
      profile.getByRole("button", { name: "Block" }),
    ).toBeVisible();

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
    const directUrl = alicePage.url();

    const directShell = alicePage.getByTestId(
      "direct-chat-shell",
    );
    await expect(directShell).toContainText(
      `@${bobHandle}`,
    );

    await alicePage.goto("/app");
    const directRow = alicePage
      .getByTestId("direct-conversation-row")
      .filter({ hasText: `@${bobHandle}` });
    await expect(directRow).toBeVisible({ timeout: 20_000 });
    let failMutePreferenceLoad = true;
    await alicePage.route(
      "**/v1/trust/surfaces/*/preference",
      async (route) => {
        if (
          failMutePreferenceLoad &&
          route.request().method() === "GET"
        ) {
          failMutePreferenceLoad = false;
          await route.abort("failed");
          return;
        }
        await route.continue();
      },
    );
    await directRow.click();
    await expect(
      alicePage.getByTestId("direct-chat-shell"),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      alicePage.getByText(
        "Mute setting is temporarily unavailable. Retry to load the current value.",
      ),
    ).toBeVisible();
    await expect(
      alicePage.getByRole("switch", {
        name: "Mute this chat",
      }),
    ).toHaveCount(0);
    await alicePage.getByRole("button", { name: "Try again" }).click();

    const mute = alicePage.getByRole("switch", {
      name: "Mute this chat",
    });
    await expect(mute).toBeVisible();
    await alicePage.unroute(
      "**/v1/trust/surfaces/*/preference",
    );
    await mute.check();
    await expect(mute).toBeChecked();

    await alicePage
      .getByTestId("direct-chat-shell")
      .getByRole("button", { name: "Report", exact: true })
      .click();
    const reportDialog = alicePage.getByRole("dialog", {
      name: `Report @${bobHandle}`,
    });
    await expect(reportDialog).toBeVisible();
    let releaseReport!: () => void;
    let signalReportHeld!: () => void;
    const reportHeld = new Promise<void>((resolve) => {
      signalReportHeld = resolve;
    });
    const reportRelease = new Promise<void>((resolve) => {
      releaseReport = resolve;
    });
    await alicePage.route(
      "**/v1/trust/reports",
      async (route) => {
        if (route.request().method() === "POST") {
          signalReportHeld();
          await reportRelease;
        }
        await route.continue();
      },
    );
    const submitReport = reportDialog.getByRole("button", {
      name: "Submit report",
    });
    await submitReport.click();
    await reportHeld;
    await alicePage.keyboard.press("Escape");
    await expect(reportDialog).toBeVisible();
    await expect(submitReport).toBeDisabled();
    releaseReport();
    await expect(
      reportDialog.getByText("Report submitted."),
    ).toBeVisible();
    await alicePage.unroute("**/v1/trust/reports");
    await reportDialog
      .getByRole("button", { name: "Done" })
      .click();

    let abortPendingSend = true;
    await alicePage.route(
      "**/v1/direct-chats/*/messages",
      async (route) => {
        if (
          abortPendingSend &&
          route.request().method() === "POST"
        ) {
          abortPendingSend = false;
          await route.abort("failed");
          return;
        }
        await route.continue();
      },
    );
    const pendingBeforeOwnBlock =
      "pending must not survive own block";
    await alicePage
      .getByPlaceholder("Message this person")
      .fill(pendingBeforeOwnBlock);
    await alicePage
      .getByTestId("chat-composer-send")
      .click();
    await expect.poll(() => abortPendingSend).toBe(false);
    await alicePage.unroute(
      "**/v1/direct-chats/*/messages",
    );

    await alicePage
      .getByTestId("direct-chat-shell")
      .getByRole("button", { name: "Block", exact: true })
      .click();
    const blockDialog = alicePage.getByRole("dialog", {
      name: `Block @${bobHandle}?`,
    });
    await expect(blockDialog).toBeVisible();
    await blockDialog
      .getByRole("button", { name: "Block", exact: true })
      .click();
    await expect(
      alicePage.getByPlaceholder("Message this person"),
    ).toBeDisabled();

    await alicePage.reload();
    await expect(
      alicePage.getByTestId("direct-chat-shell"),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      alicePage.getByPlaceholder("Message this person"),
    ).toBeDisabled();
    await expect(
      alicePage
        .getByTestId("direct-chat-shell")
        .getByRole("button", {
          name: "Block",
          exact: true,
        }),
    ).toBeDisabled();

    let allowBlockedListLoad = false;
    await alicePage.route(
      "**/v1/trust/blocks*",
      async (route) => {
        if (
          !allowBlockedListLoad &&
          route.request().method() === "GET"
        ) {
          await route.abort("failed");
          return;
        }
        await route.continue();
      },
    );
    await alicePage.goto("/settings/safety");
    await expect(
      alicePage.getByRole("heading", { name: "Safety" }),
    ).toBeVisible();
    await expect(
      alicePage.getByText("You have not blocked anyone."),
    ).toHaveCount(0);
    const retryBlockedList = alicePage.getByRole("button", {
      name: "Try again",
    });
    await expect(retryBlockedList).toBeVisible();
    allowBlockedListLoad = true;
    await retryBlockedList.click();
    const blockedCard = alicePage
      .getByTestId("blocked-user-row")
      .filter({ hasText: `@${bobHandle}` });
    await expect(blockedCard).toContainText("Bobby Profile");
    await blockedCard
      .getByRole("button", { name: "Unblock" })
      .click();
    await expect(
      alicePage.getByText(`@${bobHandle}`),
    ).toHaveCount(0);
    await alicePage.unroute("**/v1/trust/blocks*");

    await alicePage.goto(directUrl);
    await expect(
      alicePage.getByTestId("direct-chat-shell"),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      alicePage
        .getByTestId("direct-message-human")
        .filter({ hasText: pendingBeforeOwnBlock }),
    ).toHaveCount(0);
    await alicePage.waitForTimeout(1_000);
    await expect(
      alicePage
        .getByTestId("direct-message-human")
        .filter({ hasText: pendingBeforeOwnBlock }),
    ).toHaveCount(0);

    await bobContext.close();
    await aliceContext.close();
  });
});
