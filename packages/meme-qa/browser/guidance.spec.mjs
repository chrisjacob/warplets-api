import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  expect(
    (await page.request.post("http://127.0.0.1:8798/__qa/reset")).ok(),
  ).toBeTruthy();
});
test("the next step follows account verification, and an expired round never invites a vote", async ({
  page,
}) => {
  let mode = "guest";
  await page.route("**/api/meme/state?view=today", async (route) => {
    const response = await route.fetch(),
      body = await response.json();
    body.identity = {
      ...body.identity,
      farcasterFid: mode === "guest" ? null : 42,
      solanaWallet:
        mode === "verified" || mode === "closed" ? "1".repeat(32) : null,
    };
    if (mode === "closed") body.round.closes_at = body.serverTime - 1;
    await route.fulfill({ response, json: body });
  });
  await page.goto("/");
  const next = page.getByRole("region", { name: "Your next step" });
  await expect(
    next.getByRole("heading", { name: "Start with Farcaster" }),
  ).toBeVisible();
  await expect(
    next.getByRole("button", { name: "Connect to vote" }),
  ).toBeVisible();
  mode = "connected";
  await page.reload();
  await expect(
    next.getByRole("heading", { name: "Set your reward wallet" }),
  ).toBeVisible();
  await expect(
    next.getByRole("button", { name: "Verify wallet" }),
  ).toBeVisible();
  mode = "verified";
  await page.reload();
  await expect(
    next.getByRole("heading", { name: "You’re ready to vote" }),
  ).toBeVisible();
  await expect(next.locator(".is-complete")).toHaveCount(2);
  mode = "closed";
  await page.reload();
  await expect(
    next.getByRole("heading", { name: "Selection pending" }),
  ).toBeVisible();
  await expect(
    next.getByRole("button", { name: "Connect to vote" }),
  ).toHaveCount(0);
  for (const button of await page
    .getByRole("button", { name: "Vote", exact: true })
    .all())
    await expect(button).toBeDisabled();
});
test("the illustrated guide keeps its actions visible on short phones and restores focus", async ({
  page,
  browserName,
}, info) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto("/");
  const open = page.getByRole("button", { name: "Quick tour" });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "How 10X works" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading")).toBeFocused();
  const beforeScroll = await page.evaluate(() => scrollY);
  // Mobile WebKit has no wheel input; its keyboard scroll must stay in the modal too.
  if (browserName === "webkit") await page.keyboard.press("PageDown");
  else {
    await page.mouse.move(2, 2);
    await page.mouse.wheel(0, 400);
  }
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  expect(await page.evaluate(() => scrollY)).toBe(beforeScroll);
  for (const step of [1, 2, 3]) {
    const action = dialog.getByRole("button", {
      name: step === 3 ? "Got it" : "Next",
      exact: true,
    });
    const box = await action.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(480);
    await expect(
      dialog.getByRole("button", { name: "Go to guide step " + step }),
    ).toHaveAttribute("aria-current", "step");
    if (step < 3) await action.click();
  }
  await page.screenshot({ path: info.outputPath("short-phone-guide.png") });
  const details = dialog.getByRole("region", { name: "Guide details" });
  await details.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await dialog.getByRole("button", { name: "Back", exact: true }).click();
  await expect
    .poll(() => details.evaluate((element) => element.scrollTop))
    .toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Getting started" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Verify wallet", exact: true }),
  ).toBeFocused();
  const help = page.getByRole("button", { name: "How it works", exact: true });
  await help.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toBeFocused();
  await expect(
    page
      .getByRole("navigation", { name: "Legal" })
      .getByRole("link", { name: "Terms of Service" }),
  ).toHaveAttribute("href", "https://app.10x.meme/terms");
});
test("a rejected vote has persistent inline recovery and never displays a success toast", async ({
  page,
}) => {
  await page.route("**/api/meme/state?view=today", async (route) => {
    const response = await route.fetch(),
      body = await response.json();
    body.identity.solanaWallet = "1".repeat(32);
    await route.fulfill({ response, json: body });
  });
  await page.goto("/");
  // Only the displayed session is altered: the actual disposable Worker must reject the missing wallet proof.
  await page.getByRole("button", { name: "Vote", exact: true }).first().click();
  const toast = page.locator(".app-toast");
  await expect(toast).toContainText("Couldn’t save your vote. Try again.");
  await expect(toast).toHaveAttribute("role", "alert");
  await page
    .getByRole("button", { name: "Close message", exact: true })
    .click();
  await expect(toast).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Today’s round" }).getByRole("alert"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "✓ Voted" })).toHaveCount(0);
});
