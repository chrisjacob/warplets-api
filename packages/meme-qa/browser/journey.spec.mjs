import { test, expect } from "@playwright/test";
test("root discovery metadata uses the actual local origin and prepared PNG assets", async ({
  page,
}) => {
  await page.goto("/");
  const value = await page
      .locator('meta[name="fc:miniapp"]')
      .getAttribute("content"),
    embed = JSON.parse(value);
  expect(embed.imageUrl).toBe("http://127.0.0.1:5196/social-mini.png");
  expect(embed.button.action.url).toBe("http://127.0.0.1:5196/");
  expect(
    await page.locator('meta[property="og:image"]').getAttribute("content"),
  ).toBe("http://127.0.0.1:5196/social-og.png");
  for (const [path, width, height] of [
    ["icon.png", 512, 512],
    ["social-mini.png", 1200, 800],
    ["social-og.png", 1200, 630],
  ]) {
    const response = await page.request.get("/" + path),
      bytes = await response.body();
    expect(bytes.readUInt32BE(16)).toBe(width);
    expect(bytes.readUInt32BE(20)).toBe(height);
  }
});
test("public trader profiles show only the pinned published metrics and recover from unknown identities", async ({
  page,
}, testInfo) => {
  await page.goto("/?view=Leaders");
  await page.getByRole("button", { name: "Trading", exact: true }).click();
  await page.getByRole("button", { name: "#1 · FID 42", exact: true }).click();
  const profile = page.getByRole("region", { name: "Trader profile" });
  await expect(profile.getByText("$38.50", { exact: true })).toBeVisible();
  await expect(
    profile.getByRole("link", { name: "Farcaster profile" }),
  ).toHaveAttribute("href", "https://farcaster.xyz/~/profiles/42");
  await profile.getByText("Cost & OG gains", { exact: true }).click();
  await expect(profile.getByText(/23.5 OG units/)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("trader-profile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await profile.getByRole("button", { name: "Back to leaders" }).click();
  await page.getByLabel("Farcaster ID", { exact: true }).fill("999");
  await page.getByRole("button", { name: "View trader", exact: true }).click();
  await expect(profile.getByText(/No published trading profile/)).toBeVisible();
});
test("onboarding stays dismissed across tabs when its storage key is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem"]) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (key, ...args) {
        if (key === "10x:launchpad:onboarding:v1")
          throw new DOMException("Storage denied");
        return original.call(this, key, ...args);
      };
    }
  });
  await page.goto("/");
  const guide = page.getByRole("region", { name: "Getting started" });
  await guide.getByRole("button", { name: "Skip", exact: true }).click();
  await page.getByRole("tab", { name: "Rewards", exact: true }).click();
  await page.getByRole("tab", { name: "Today", exact: true }).click();
  await expect(guide).toHaveCount(0);
  await page.getByRole("button", { name: "How it works" }).click();
  await expect(guide).toBeVisible();
});
test("an expired session stops automatic polling and a manual retry recovers", async ({
  page,
}) => {
  let rejected = true,
    calls = 0;
  await page.clock.install();
  await page.route("**/api/meme/state?view=today", async (route) => {
    calls++;
    if (rejected)
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"error":"Expired"}',
      });
    else await route.continue();
  });
  await page.goto("/");
  await expect(
    page.getByText("Sign in again to continue.", { exact: true }),
  ).toBeVisible();
  const before = calls;
  await page.clock.runFor(180000);
  expect(calls).toBe(before);
  rejected = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Cast", exact: true }),
  ).toBeVisible();
});
test("notification topics save without requesting host permission or sending messages", async ({
  page,
}) => {
  await page.goto("/?view=Rewards");
  await page.getByText("Notifications", { exact: true }).click();
  const voting = page.getByRole("checkbox", { name: "Voting opens" });
  await expect(voting).toBeChecked();
  await voting.uncheck();
  await expect(
    page.getByText("Preferences saved.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Enable in Farcaster/ }),
  ).toBeDisabled();
  const response = await page.request.get("/api/meme/notifications"),
    value = await response.json();
  expect(value.deliveryEnabled).toBe(false);
  expect(value.settings.voting).toBe(0);
  expect(value.settings.enabled).toBe(0);
  await page.reload();
  await page.getByText("Notifications", { exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Voting opens" }),
  ).not.toBeChecked();
});
test("share opens only a user-initiated sheet with an immutable server card and real PNGs", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data) => {
        window.__qaShared = data;
      },
    });
  });
  await page.goto("/");
  const market = page.getByRole("region", { name: "Token performance" });
  await expect(
    market.getByRole("button", { name: "Share", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.__qaShared)).toBeUndefined();
  await market.getByRole("button", { name: "Share", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__qaShared?.url))
    .toMatch(/\/api\/meme\/share\/[a-f0-9]{64}$/);
  const url = await page.evaluate(() => window.__qaShared.url),
    html = await page.request.get(url);
  expect(html.status()).toBe(200);
  expect(await html.text()).toContain("fc:miniapp");
  expect(await html.text()).toContain("Simulated");
  for (const [format, height] of [
    ["mini", 800],
    ["og", 630],
  ]) {
    const image = await page.request.get(url + "/" + format + ".png"),
      bytes = await image.body();
    expect(image.headers()["content-type"]).toBe("image/png");
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(height);
  }
  await page.getByRole("tab", { name: "Leaders", exact: true }).click();
  await page.getByRole("button", { name: "Trading", exact: true }).click();
  await page.getByRole("button", { name: "Share P&L", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__qaShared?.title))
    .toContain("realized P&L");
});
test("matched markets and separate trading ranks stay readable and never enable financial actions", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const market = page.getByRole("region", { name: "Token performance" });
  await expect(
    market.getByText("ATTN ahead by 60 percentage points."),
  ).toBeVisible();
  await expect(
    market.getByRole("img", { name: /Matched price performance/ }),
  ).toBeVisible();
  await market.getByLabel("Period").selectOption("all");
  await expect(market.getByText("+80%", { exact: true })).toBeVisible();
  await market.getByText("Buy ATTNALPHA or ALPHA", { exact: true }).click();
  await expect(
    market.getByRole("button", { name: /trading disabled/ }),
  ).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("markets.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Leaders", exact: true }).click();
  await page.getByRole("button", { name: "Trading", exact: true }).click();
  const leaders = page.getByRole("region", { name: "Leaderboards" });
  await expect(leaders.getByText("$38.50", { exact: true })).toBeVisible();
  await expect(leaders.getByText(/Simulated trades/)).toBeVisible();
  await leaders.getByLabel("Period").selectOption("30d");
  await expect(leaders.getByText("$38.50", { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("leaders.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
test("onboarding is brief, persistent and replayable without blocking Connect", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const guide = page.getByRole("region", { name: "Getting started" });
  await expect(guide).toBeVisible();
  await guide.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    guide.getByRole("img", {
      name: "Illustrative paths show both gains and losses",
    }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("onboarding.png"),
    fullPage: true,
  });
  await guide.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    guide.getByText(/Verified trading ranks are public/),
  ).toBeVisible();
  await guide.getByRole("button", { name: "Got it" }).click();
  await expect(guide).toHaveCount(0);
  await page.reload();
  await expect(guide).toHaveCount(0);
  await page.getByRole("button", { name: "How it works" }).click();
  await expect(guide).toBeVisible();
  await guide.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(guide).toHaveCount(0);
});
async function installWallet(page, { cancel = false } = {}) {
  await page.addInitScript(
    async ({ cancel }) => {
      const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
        "sign",
        "verify",
      ]);
      const publicKey = new Uint8Array(
        await crypto.subtle.exportKey("raw", keys.publicKey),
      );
      const alphabet =
        "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
      let n = BigInt(
          "0x" +
            Array.from(publicKey, (b) => b.toString(16).padStart(2, "0")).join(
              "",
            ),
        ),
        address = "";
      while (n) {
        address = alphabet[Number(n % 58n)] + address;
        n /= 58n;
      }
      for (const b of publicKey) {
        if (b !== 0) break;
        address = "1" + address;
      }
      const account = {
        address,
        publicKey,
        chains: ["solana:mainnet"],
        features: ["solana:signMessage"],
      };
      const wallet = {
        version: "1.0.0",
        name: "Disposable QA Wallet",
        icon: "data:image/svg+xml;base64,PHN2Zy8+",
        chains: ["solana:mainnet"],
        accounts: [account],
        features: {
          "standard:connect": {
            version: "1.0.0",
            connect: async () => ({ accounts: [account] }),
          },
          "standard:events": { version: "1.0.0", on: () => () => {} },
          "solana:signMessage": {
            version: "1.0.0",
            signMessage: async (input) => {
              if (cancel) throw Error("User rejected the request");
              return [
                {
                  signedMessage: input.message,
                  signature: new Uint8Array(
                    await crypto.subtle.sign(
                      "Ed25519",
                      keys.privateKey,
                      input.message,
                    ),
                  ),
                },
              ];
            },
          },
        },
      };
      window.addEventListener("wallet-standard:app-ready", (event) =>
        event.detail.register(wallet),
      );
      window.dispatchEvent(
        new CustomEvent("wallet-standard:register-wallet", {
          detail: (api) => api.register(wallet),
        }),
      );
    },
    { cancel },
  );
}
test.beforeEach(async ({ page }) => {
  await page.context().route("**/*", (route) => {
    const u = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(u.hostname)
      ? route.continue()
      : route.abort();
  });
  const r = await page.request.post("http://127.0.0.1:8798/__qa/reset");
  expect(r.ok(), await r.text()).toBeTruthy();
});
test("an unavailable wallet picker keeps sign-in and other wallet options usable", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Account/ }).click();
  const other = page
    .locator(".web-connect-provider-card")
    .filter({ hasText: "Other wallets" });
  await other.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(
    page.getByText(
      "Other wallets are temporarily unavailable. Please try again later.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Couldn’t open Connect.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Disconnect", exact: true }),
  ).toBeVisible();
  await expect(
    other.getByRole("button", { name: "Connect", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Verify reward wallet", exact: true }),
  ).toBeVisible();
});
test("Other wallets SDK loads only on demand or to restore its previous connector", async ({
  page,
}) => {
  const bridges = [];
  page.on("request", (request) => {
    if (request.url().includes("TrustConnectBridge"))
      bridges.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^Account/ }).click();
  await expect(
    page.getByRole("button", { name: "Disconnect", exact: true }),
  ).toBeVisible();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  expect(bridges).toHaveLength(0);
  await page
    .locator(".web-connect-provider-card")
    .filter({ hasText: "Other wallets" })
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await expect.poll(() => bridges.length).toBeGreaterThan(0);
  await expect(
    page.getByText(
      "Other wallets are temporarily unavailable. Please try again later.",
      { exact: true },
    ),
  ).toBeVisible();
  bridges.length = 0;
  await page.addInitScript(() =>
    localStorage.setItem(
      "warplets_wallet_connector",
      "trustconnect-walletconnect",
    ),
  );
  await page.reload();
  await page.getByRole("button", { name: /^Account/ }).click();
  await expect.poll(() => bridges.length).toBeGreaterThan(0);
});
test("an operator participation pause is visible without opening a wallet", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Voting open", { exact: true })).toBeVisible();
  expect(
    (await page.request.post("http://127.0.0.1:8798/__qa/pause-voting")).ok(),
  ).toBeTruthy();
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.getByText("Voting paused", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Verify wallet", exact: true }),
  ).toHaveCount(0);
  for (const button of await page
    .getByRole("button", { name: "Vote", exact: true })
    .all())
    await expect(button).toBeDisabled();
});
test("history reaches older rounds and a failed next page retries without duplicates", async ({
  page,
}) => {
  expect(
    (await page.request.post("http://127.0.0.1:8798/__qa/archive")).ok(),
  ).toBeTruthy();
  let fail = true;
  await page.route("**/api/meme/history?cursor=*", async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":"Temporary local failure"}',
      });
    } else await route.continue();
  });
  await page.goto("/");
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await expect(page.locator("article.history-row")).toHaveCount(20);
  await page.getByRole("button", { name: "Load more rounds" }).click();
  await expect(
    page.getByText("Couldn’t load this page. Try again."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator("article.history-row")).toHaveCount(40);
  await page.getByRole("button", { name: "Load more rounds" }).click();
  await expect(page.locator("article.history-row")).toHaveCount(54);
  await expect(
    page.getByRole("button", { name: "Load more rounds" }),
  ).toHaveCount(0);
});
test("reward pages contain whole campaigns; expired access clears cached private rewards", async ({
  page,
}) => {
  expect(
    (await page.request.post("http://127.0.0.1:8798/__qa/archive")).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await page.getByRole("tab", { name: "Rewards", exact: true }).click();
  await expect(page.locator("article.reward-row")).toHaveCount(20);
  await expect(
    page.getByText("90,071,992,547,409,930 QA44", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Load older rewards" }).click();
  await expect(page.locator("article.reward-row")).toHaveCount(40);
  await page.route("**/api/meme/rewards", (route) =>
    route.fulfill({
      status: 401,
      contentType: "text/html",
      body: "<form>Access expired</form>",
    }),
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("Sign in again to continue.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("article.reward-row")).toHaveCount(0);
});
test("an account change discards an in-flight private reward page", async ({
  page,
}) => {
  expect(
    (await page.request.post("http://127.0.0.1:8798/__qa/archive")).ok(),
  ).toBeTruthy();
  let release, started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/meme/rewards?cursor=*", async (route) => {
    const response = await route.fetch();
    started();
    await hold;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.goto("/");
  await page.getByRole("tab", { name: "Rewards", exact: true }).click();
  await expect(page.locator("article.reward-row")).toHaveCount(20);
  await page.getByRole("button", { name: "Load older rewards" }).click();
  await ready;
  expect(
    (await page.request.post("http://127.0.0.1:8798/__qa/switch-account")).ok(),
  ).toBeTruthy();
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.getByRole("button", { name: "Account · 43", exact: true }),
  ).toBeVisible();
  release();
  await expect(
    page.getByText("No rewards yet. Vote in the next round.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("article.reward-row")).toHaveCount(0);
});
test("voting closes at the displayed server deadline without waiting for polling", async ({
  page,
}) => {
  await page.clock.install();
  await page.route("**/api/meme/state?view=today", async (route) => {
    const response = await route.fetch(),
      body = await response.json();
    body.round.closes_at = body.serverTime + 1000;
    body.identity.solanaWallet = "1".repeat(32);
    await route.fulfill({ response, json: body });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Vote", exact: true }).first(),
  ).toBeEnabled();
  await page.clock.fastForward(1100);
  await expect(page.getByText("Voting closed", { exact: true })).toBeVisible();
  for (const button of await page
    .getByRole("button", { name: "Vote", exact: true })
    .all())
    await expect(button).toBeDisabled();
});
test("read panels keep mobile layout within the viewport", async ({
  page,
}, info) => {
  expect(
    (await page.request.post("http://127.0.0.1:8798/__qa/archive")).ok(),
  ).toBeTruthy();
  await page.goto("/");
  for (const tab of ["Today", "Rewards", "History"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    if (tab === "Rewards")
      await expect(page.locator("article.reward-row")).toHaveCount(20);
    if (tab === "History")
      await expect(page.locator("article.history-row")).toHaveCount(20);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `../../.tmp/meme-qa/review-${info.project.name}-${tab.toLowerCase()}.png`,
    });
  }
});
test("real Solana proof, changed vote, operator selection and history use the actual local Worker", async ({
  page,
}) => {
  await installWallet(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Verify wallet", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Verify reward wallet", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Verify reward wallet", exact: true })
    .click();
  await expect(page.getByText(/Verified ·/)).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Reward wallet verified." }),
  ).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(1);
  await page.keyboard.press("Escape");
  const alpha = page
    .locator("article.candidate")
    .filter({ has: page.getByRole("heading", { name: "Alpha", exact: true }) });
  const beta = page
    .locator("article.candidate")
    .filter({ has: page.getByRole("heading", { name: "Beta", exact: true }) });
  await alpha.getByRole("button", { name: "Vote", exact: true }).click();
  await expect(alpha.getByRole("button", { name: "✓ Voted" })).toBeVisible();
  const first = await (await page.request.get("/api/meme/state")).json();
  await beta.getByRole("button", { name: "Vote", exact: true }).click();
  await expect(beta.getByRole("button", { name: "✓ Voted" })).toBeVisible();
  const second = await (await page.request.get("/api/meme/state")).json();
  expect(second.myVote.first_valid_at).toBe(first.myVote.first_valid_at);
  expect(second.myVote.reward_wallet).toBe(first.myVote.reward_wallet);
  const selected = await page.request.post("http://127.0.0.1:8798/__qa/select");
  expect(selected.ok(), await selected.text()).toBeTruthy();
  await page.reload();
  await expect(
    page.getByText("Reward wallet verified.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Selected: Beta" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await expect(page.getByText("Selected: Beta", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Rewards", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Claims coming later" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
test("wallet cancellation stays recoverable and skip is clear", async ({
  page,
}) => {
  await installWallet(page, { cancel: true });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Verify wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Verify reward wallet", exact: true })
    .click();
  await expect(
    page.getByText("User rejected the request", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Reward wallet verified.", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Verify reward wallet", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  const skipped = await page.request.post("http://127.0.0.1:8798/__qa/skip");
  expect(skipped.ok(), await skipped.text()).toBeTruthy();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "No launch today" }),
  ).toBeVisible();
});

test("reduced-motion wallet success is announced without animation and can be dismissed", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installWallet(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Verify wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Verify reward wallet", exact: true })
    .click();
  await expect(
    page.getByText("Reward wallet verified.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Dismiss connection message" })
    .click();
  await expect(
    page.getByText("Reward wallet verified.", { exact: true }),
  ).toHaveCount(0);
});
test("test harness and financial actions do not enter the production Worker routes", async ({
  page,
}) => {
  for (const path of ["/api/meme/transactions/sign", "/api/meme/claims"]) {
    const r = await page.request.get(path);
    expect([401, 403, 404, 423]).toContain(r.status());
  }
  const r = await page.request.post("/api/meme/operator/transactions", {
    headers: { origin: "http://127.0.0.1:5196" },
    data: { plan: {} },
  });
  expect(r.status()).toBe(401);
});
