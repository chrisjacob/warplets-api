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
test("collapsed preferences load neither their code nor data until opened and do not refetch on a simple reopen", async ({
  page,
}) => {
  let reads = 0,
    chunks = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/meme/notifications" &&
      request.method() === "GET"
    )
      reads++;
    if (request.url().includes("NotificationSettings")) chunks++;
  });
  const rewards = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/meme/rewards",
  );
  await page.goto("/?view=Rewards");
  await rewards;
  await expect(
    page.getByRole("heading", { name: "Your rewards" }),
  ).toBeVisible();
  expect(reads).toBe(0);
  expect(chunks).toBe(0);
  const disclosure = page.getByText("Notifications", { exact: true });
  await disclosure.click();
  await expect(
    page.getByRole("checkbox", { name: "Voting opens" }),
  ).toBeEnabled();
  expect(reads).toBeGreaterThan(0);
  expect(chunks).toBeGreaterThan(0);
  const loaded = reads;
  await disclosure.click();
  await disclosure.click();
  await expect(
    page.getByRole("checkbox", { name: "Voting opens" }),
  ).toBeEnabled();
  expect(reads).toBe(loaded);
});
async function retainOldAccount(page, verified = false) {
  let snapshot;
  await page.route("**/api/meme/state?view=today", async (route) => {
    if (!snapshot) {
      snapshot = await (await route.fetch()).json();
      if (verified) snapshot.identity.solanaWallet = "1".repeat(32);
    }
    await route.fulfill({ json: snapshot });
  });
}
test("malformed preferences stay recoverable without crashing the account or enabling writes", async ({
  page,
}) => {
  let malformed = true;
  await page.route("**/api/meme/notifications", (route) =>
    malformed
      ? route.fulfill({ json: { viewerFid: 42, settings: null } })
      : route.continue(),
  );
  await page.goto("/?view=Rewards");
  await page.getByText("Notifications", { exact: true }).click();
  const voting = page.getByRole("checkbox", { name: "Voting opens" });
  await expect(voting).toBeDisabled();
  await expect(
    page.getByText("Preferences unavailable.", { exact: true }),
  ).toBeVisible();
  malformed = false;
  await page.getByRole("button", { name: "Retry preferences" }).click();
  await expect(voting).toBeEnabled();
  malformed = true;
  // The rejected response can restore the checkbox before uncheck() checks its
  // intermediate state, especially on Linux WebKit. Assert the durable result.
  await voting.click();
  await expect(
    page.getByText("Couldn’t save preferences. Try again.", { exact: true }),
  ).toBeVisible();
  await expect(voting).toBeChecked();
  await page.getByRole("tab", { name: "Today", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Today’s round" }),
  ).toBeVisible();
});

test("a stale tab cannot save notification preferences into a different signed-in account", async ({
  page,
}) => {
  await retainOldAccount(page);
  await page.goto("/?view=Rewards");
  await page.getByText("Notifications", { exact: true }).click();
  const voting = page.getByRole("checkbox", { name: "Voting opens" });
  await expect(voting).toBeEnabled();
  expect(
    (await page.request.post("http://127.0.0.1:8798/__qa/switch-account")).ok(),
  ).toBeTruthy();
  const write = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/meme/notifications" &&
      response.request().method() === "POST",
  );
  await voting.click();
  const result = await write;
  expect(result.status()).toBe(409);
  expect(result.request().headers()["x-meme-viewer-fid"]).toBe("42");
  await expect(
    page
      .getByRole("region", { name: "Notification preferences" })
      .getByRole("alert"),
  ).toContainText("Account changed");
  await expect(voting).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Reconnect", exact: true }),
  ).toBeVisible();
  const other = await (
    await page.request.get("/api/meme/notifications")
  ).json();
  expect(other.viewerFid).toBe(43);
  expect(other.settings.voting).toBe(1);
  expect(other.settings.enabled).toBe(0);
});
test("votes are bound to the displayed account before any wallet or round writes", async ({
  page,
}) => {
  await retainOldAccount(page, true);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "You’re ready to vote" }),
  ).toBeVisible();
  await page.request.post("http://127.0.0.1:8798/__qa/switch-account");
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/vote") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Vote", exact: true }).first().click();
  expect((await response).status()).toBe(409);
  await expect(page.getByRole("button", { name: "✓ Voted" })).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Today’s round" }).getByRole("alert"),
  ).toContainText("Account changed");
});
test("market periods survive reload and intraday chart endpoints show times", async ({
  page,
}, info) => {
  await page.goto("/?market=fixture-alpha&marketWindow=30d");
  const panel = page.getByRole("region", { name: "Token performance" }),
    period = panel.getByRole("combobox", { name: "Period" });
  await expect(period).toHaveValue("30d");
  await expect(
    panel.getByRole("group", { name: "Explore matched prices" }),
  ).toBeVisible();
  await period.selectOption("all");
  await expect(page).toHaveURL(/marketWindow=all/);
  await page.reload();
  await expect(period).toHaveValue("all");
  const chart = panel.locator(".performance-chart");
  await expect(chart).toBeVisible();
  const endpoints = chart
    .locator("text")
    .filter({ has: page.locator("title") });
  await expect(endpoints).toHaveCount(2);
  const visibleEndpoint = await endpoints.first().evaluate((element) =>
    Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join(""),
  );
  expect(visibleEndpoint).toMatch(/\d{1,2}:\d{2}/);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("market-context.png") });
});
test("trading periods and snapshot-pinned profiles survive reload and explicit back returns to the same period", async ({
  page,
}) => {
  await page.goto("/?view=Leaders");
  await page.getByRole("button", { name: "Trading", exact: true }).click();
  const period = page.getByRole("combobox", { name: "Period" });
  await period.selectOption("30d");
  await page.getByRole("button", { name: "#1 · FID 42", exact: true }).click();
  expect(new URL(page.url()).searchParams.get("trader")).toBe("42");
  expect(new URL(page.url()).searchParams.get("board")).toMatch(
    /^board:[a-f0-9]{64}$/,
  );
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Trader profile" }),
  ).toContainText("Saved snapshot");
  await page.getByRole("button", { name: "Back to leaders" }).click();
  await expect(period).toHaveValue("30d");
  expect(new URL(page.url()).searchParams.has("trader")).toBe(false);
  expect(new URL(page.url()).searchParams.has("board")).toBe(false);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Trading", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(period).toHaveValue("30d");
});
