import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page
    .context()
    .route("**/*", (route) =>
      ["127.0.0.1", "localhost"].includes(
        new URL(route.request().url()).hostname,
      )
        ? route.continue()
        : route.abort(),
    );
  const response = await page.request.post("http://127.0.0.1:8798/__qa/reset");
  expect(response.ok()).toBeTruthy();
});

test("mobile chrome fits narrow screens and the menu returns keyboard focus", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Cast", exact: true }),
  ).toBeVisible();
  const skip = page.getByRole("link", { name: "Skip to content", exact: true });
  await skip.focus();
  await skip.press("Enter");
  await expect(page.getByRole("tabpanel")).toBeFocused();
  for (const width of [320, 390, 500, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    const bounds = await page.locator("main").boundingBox();
    expect(bounds.width).toBeLessThanOrEqual(500);
    const menu = await page
      .getByRole("button", { name: "Open menu", exact: true })
      .boundingBox();
    expect(menu.width).toBeGreaterThanOrEqual(44);
    expect(menu.height).toBeGreaterThanOrEqual(44);
  }
  const trigger = page.getByRole("button", { name: "Open menu", exact: true });
  await trigger.click();
  const menu = page.getByRole("dialog", { name: "Explore 10X" });
  await expect(menu).toBeVisible();
  await expect(
    menu.getByRole("link", { name: /10X Warplets/ }),
  ).toHaveAttribute("href", "https://warplet.10x.meme/");
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await menu.getByRole("button", { name: /How it works/ }).click();
  await expect(menu).not.toBeVisible();
  await expect(page.locator(".onboarding h2")).toBeFocused();
});

test("navigation preserves the selected view on reload and keeps controls on screen", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Rewards", exact: true }).click();
  await expect(page).toHaveURL(/view=Rewards/);
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Rewards", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", { name: "Your rewards", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Today", exact: true }).click();
  await expect(page).not.toHaveURL(/view=/);
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  const nav = await page.getByRole("tablist").boundingBox();
  expect(nav.y).toBeGreaterThanOrEqual(0);
  expect(nav.y + nav.height).toBeLessThanOrEqual(844);
});

test("price inspection works by keyboard without collecting or changing evidence", async ({
  page,
}) => {
  const writes = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/meme/"))
      writes.push(request.url());
  });
  await page.goto("/");
  const chart = page.getByRole("group", { name: "Explore matched prices" });
  await expect(chart).toBeVisible();
  await chart.focus();
  await page.keyboard.press("Home");
  const readout = page.locator(".chart-readout");
  await expect(readout).toBeVisible();
  const start = await readout.textContent();
  await page.keyboard.press("End");
  await expect(readout).not.toHaveText(start);
  await expect(readout).toContainText("ATTN");
  await expect(readout).toContainText("OG");
  expect(writes).toHaveLength(0);
});
