import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(u.hostname) ||
      ["data:", "blob:"].includes(u.protocol)
      ? route.continue()
      : route.abort();
  });
});
test("seeded month populates real screens and synthetic profiles without external services", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?qa=seeded");
  await expect(
    page.getByRole("tab", { name: "Today", exact: true }),
  ).toBeVisible({ timeout: 90000 });
  if (await page.getByRole("button", { name: "Skip", exact: true }).count())
    await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Today’s round" }).locator(".candidate"),
  ).toHaveCount(3);
  await expect(
    page
      .getByRole("region", { name: "Token performance" })
      .getByText("Simulated prices", { exact: false }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await expect(page.locator(".history-row")).toHaveCount(20);
  await page.getByRole("button", { name: "Load more rounds" }).click();
  await expect(page.locator(".history-row")).toHaveCount(30);
  await expect(
    page.getByRole("link", { name: /View performance/ }),
  ).toHaveCount(30);
  await page.getByRole("tab", { name: "Rewards", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Simulate claim all" }),
  ).toBeEnabled();
  await expect(page.locator(".reward-row").first()).toBeVisible();
  await page.getByRole("tab", { name: "Leaders", exact: true }).click();
  await expect(page.locator(".leaderboard>li")).toHaveCount(100);
  await page.getByRole("button", { name: "Trading", exact: true }).click();
  await expect(page.locator(".leaderboard>li")).toHaveCount(100);
  await page.locator(".leaderboard>li button.text-button").first().click();
  await expect(
    page.getByRole("region", { name: "Trader profile" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Farcaster profile" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("populated-profile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});
test("vote changes, local trades, claims and share previews stay inside QA", async ({
  page,
}) => {
  await page.goto("/?qa=seeded");
  await expect(
    page.getByRole("tab", { name: "Today", exact: true }),
  ).toBeVisible({ timeout: 90000 });
  const round = page.getByRole("region", { name: "Today’s round" });
  await round
    .getByRole("button", { name: "Vote", exact: true })
    .first()
    .click();
  await expect(
    round.getByRole("button", { name: "✓ Voted", exact: true }),
  ).toBeVisible();
  await round.getByRole("button", { name: "Vote", exact: true }).last().click();
  await expect(
    round.getByText("Vote saved. You can change it until close.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByText(/Simulate trading ATTN/).click();
  await page.getByRole("button", { name: "Simulate buy", exact: true }).click();
  await expect(
    page.getByText("Trade simulated. Rankings updated.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("region", { name: "Token performance" })
    .getByRole("button", { name: "Share", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "QA share preview" }),
  ).toBeVisible();
  const image = page.getByRole("img", {
    name: "Simulated performance share card",
  });
  await expect.poll(() => image.evaluate((e) => e.naturalWidth)).toBe(1200);
  await page.getByRole("button", { name: "Close preview" }).click();
  await page.getByRole("tab", { name: "Rewards", exact: true }).click();
  await page.getByRole("button", { name: "Simulate one claim" }).click();
  await expect(
    page.getByRole("tab", { name: "Rewards", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Rewards", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Simulate claim all" }),
  ).toBeEnabled();
});
test("seed gateway denies cross-origin, normal credentials and real signing routes", async ({
  request,
}) => {
  expect(
    (await request.get("http://127.0.0.1:8802/__qa/actions/trade")).status(),
  ).toBe(405);
  expect((await request.get("http://127.0.0.1:8802/__qa/clock")).status()).toBe(
    405,
  );
  expect(
    (
      await request.post("http://127.0.0.1:8802/__qa/clock", {
        headers: { origin: "https://evil.example" },
        data: { step: "day" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("http://127.0.0.1:8802/__qa/api/auth/solana/verify", {
        headers: { origin: "http://127.0.0.1:5197" },
        data: {},
      })
    ).status(),
  ).not.toBe(200);
  expect(
    (
      await request.get(
        "http://127.0.0.1:8802/__qa/api/meme/operator/operations/health",
      )
    ).status(),
  ).not.toBe(200);
});
test("clock changes are fenced and keep published prices and trading snapshots fresh", async ({
  request,
}) => {
  const base = "http://127.0.0.1:8802/__qa",
    context = await (await request.get(base + "/context")).json();
  const change = await request.post(base + "/clock", {
    headers: { origin: "http://127.0.0.1:5197" },
    data: { step: "hour", expectedClock: context.clock },
  });
  expect(change.status()).toBe(200);
  const next = await change.json();
  expect(next.clock).toBe(context.clock + 3600000);
  const duplicate = await request.post(base + "/clock", {
    headers: { origin: "http://127.0.0.1:5197" },
    data: { step: "hour", expectedClock: context.clock },
  });
  expect(duplicate.status()).toBe(409);
  const { board } = await (
    await request.get(base + "/api/meme/trading?window=24h")
  ).json();
  expect(board.asOf).toBe(next.clock);
  expect(board.stale).toBe(false);
});
