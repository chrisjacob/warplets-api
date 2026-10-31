import { test, expect } from "@playwright/test";
test("admin reviews candidates, publishes a frozen round, monitors metrics and previews approved communications", async ({
  page,
  request,
}, info) => {
  test.setTimeout(150000);
  const base = "http://127.0.0.1:8802/__qa",
    headers = { origin: "http://127.0.0.1:5197" };
  await page.route("**/*", (route) =>
    ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  page.on("dialog", (dialog) =>
    dialog.accept(
      dialog.type() === "prompt" ? "QA recovery exercise" : undefined,
    ),
  );
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto("/__adminhidden/meme?qa=seeded");
    await expect(page.getByText("QA simulation", { exact: true })).toBeVisible({
      timeout: 90000,
    });
    await expect(page.getByLabel("QA seed data")).toBeChecked();
    await page.getByRole("button", { name: "Next day", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "GMGN trending" }),
    ).toBeVisible();
    const feed = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "GMGN trending" }) })
      .last();
    await feed.getByRole("button", { name: "Add", exact: true }).nth(0).click();
    await feed.getByRole("button", { name: "Add", exact: true }).nth(1).click();
    await feed.getByRole("button", { name: "Add", exact: true }).nth(2).click();
    for (const checkbox of await page
      .getByLabel("Manually reviewed", { exact: true })
      .all())
      await checkbox.check();
    await page
      .getByRole("button", { name: "Save shortlist", exact: true })
      .click();
    await expect(page.locator("#message")).toHaveText("Saved.");
    await page
      .getByRole("button", { name: "Publish saved shortlist", exact: true })
      .click();
    await expect(page.locator("#message")).toHaveText("Saved.");
    await expect(page.locator("#content")).toContainText("FROZEN");
    await page.getByRole("tab", { name: "Performance", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Overall", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#content")).toContainText("Cohort volume");
    await page.getByRole("tab", { name: "Comms", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Social drafts" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Resume social composers", exact: true })
      .click();
    await expect(page.locator("#message")).toHaveText("Saved.");
    await page
      .getByRole("button", { name: "Approve draft", exact: true })
      .first()
      .click();
    await expect(page.locator("#message")).toHaveText("Saved.");
    await page
      .getByRole("button", { name: "Preview social post", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Simulated social preview" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Disable rule", exact: true })
      .first()
      .click();
    await expect(page.locator("#message")).toHaveText("Saved.");
    await page.getByRole("tab", { name: "Health", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Safety controls" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Pause collection", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Resume collection", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Resume collection", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Pause collection", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: info.outputPath("admin-health.png"),
      fullPage: true,
    });
    let context = await (await request.get(base + "/context")).json();
    let advanced = await request.post(base + "/clock", {
      headers,
      data: { step: "boundary", expectedClock: context.clock },
    });
    expect(advanced.status()).toBe(200);
    context = await advanced.json();
    await page.getByRole("tab", { name: "Today", exact: true }).click();
    await page
      .getByLabel("UTC date")
      .fill(new Date(context.clock).toISOString().slice(0, 10));
    await page.getByLabel("UTC date").dispatchEvent("change");
    await expect(page.locator("#content")).toContainText("CLOSED");
    await page
      .getByLabel("Reason", { exact: true })
      .fill("QA operator selection");
    await page
      .getByRole("button", { name: "Select candidate", exact: true })
      .click();
    await expect(page.locator("#content")).toContainText("SELECTED");
    await page
      .getByRole("button", { name: "Prepare launch review", exact: true })
      .click();
    await expect(
      page.getByText("Launch review · prepared", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Simulate launch checks", exact: true })
      .click();
    await expect(
      page.getByText("Launch review · simulated", { exact: true }),
    ).toBeVisible();
    advanced = await request.post(base + "/clock", {
      headers,
      data: { step: "hour", expectedClock: context.clock },
    });
    expect(advanced.status()).toBe(200);
    await page
      .getByRole("button", { name: "Confirm demo launch", exact: true })
      .click();
    await expect(
      page.getByText("Launch review · confirmed", { exact: true }),
    ).toBeVisible({ timeout: 60000 });
    const overview = await (await request.get(base + "/admin/overview")).json();
    expect(overview.campaigns.length).toBe(31);
    expect(overview.financialActions.launching).toBe(false);
  } finally {
    const reset = await request.post(base + "/reset", {
      headers,
      data: { scenario: "active" },
      timeout: 90000,
    });
    expect(reset.status()).toBe(200);
  }
});
