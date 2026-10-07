import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
let require = createRequire(
  new URL("./social-tools/package.json", import.meta.url),
);
try {
  require.resolve("playwright");
} catch {
  require = createRequire(
    new URL("../.tmp/social-browser-tools/package.json", import.meta.url),
  );
}
const { chromium } = require("playwright");
const base = process.env.SOCIAL_TEST_ORIGIN || "http://127.0.0.1:8793";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const output = new URL("../.tmp/social-qa/", import.meta.url).pathname.replace(
  /^\/(\w:)/,
  "$1",
);
await mkdir(output, { recursive: true });
const config = await (await fetch(base + "/api/social/config")).json();
const posts = Array.from({ length: 5 }, (_, i) => ({
  id: "ui-post-" + i,
  member_id: "author-" + i,
  username: "builder" + i,
  avatar: "https://images.example.invalid/avatar.png",
  fid: 100 + i,
  cast_hash: "0x" + String(i + 1).repeat(40),
  text: "A focused feed gives useful ideas room to be seen.\nThis is a browser-only presentation fixture.",
  embeds: i === 0 ? ["https://images.example.invalid/missing.png"] : [],
  created_at: Date.now(),
  submitted_at: Date.now(),
  kind: "original",
  likes: 8,
  comments: 2,
  recasts: 1,
  points: 25,
  rank: 1,
}));
const errors = [];
try {
  for (const width of [320, 390, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: "reduce",
    });
    await context.addInitScript(() =>
      localStorage.setItem("social-onboarding-v1", "1"),
    );
    const page = await context.newPage();
    await page.route("https://images.example.invalid/**", (route) =>
      route.abort(),
    );
    page.on("pageerror", (e) => {
      errors.push(e.message);
      console.log("Browser error", e.message);
    });
    let signed = false,
      fc = false,
      empty = false,
      failReport = false;
    const actions = [];
    const searches = [];
    let holderRequests = 0;
    const me = {
      member: {
        id: "viewer",
        group_id: "viewer",
        username: "member",
        avatar: null,
        next_post_at: 0,
      },
      evidence: {
        connection: true,
        context: false,
        notifications: false,
        signer: true,
        follow: false,
        email: false,
        streak: 2,
        warpletLevel: 3,
        stonklets: 1,
      },
      boost: {
        multiplier: 2,
        ranking: 1.2,
        contributions: {
          actions: 0.5,
          streak: 0.5,
          warplets: 0.75,
          stonklets: 0.25,
        },
      },
      totals: { points: 100, today: 10, explored: 2 },
      history: [],
      operations: [],
    };
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let data = {};
      let status = 200;
      if (path === "/api/auth/session")
        data = {
          authenticated: signed,
          walletAddress: signed
            ? "0x1111111111111111111111111111111111111111"
            : null,
          farcasterFid: fc ? 123 : null,
          farcasterProfile: fc
            ? {
                fid: 123,
                username: "socialmember",
                pfpUrl: "https://images.example.invalid/profile.png",
              }
            : null,
        };
      else if (path === "/api/social/config") data = config;
      else if (path === "/api/social/me") data = me;
      else if (path === "/api/admin/social")
        data = {
          config: config.config,
          version: 0,
          versions: [],
          reports: [],
          members: [
            {
              id: "viewer",
              username: "member",
              status: "active",
              identities: "wallet:fixture",
            },
          ],
          jobs: [],
          audit: [],
        };
      else if (path === "/api/social/feed") {
        const url = new URL(route.request().url());
        if (url.searchParams.get("section") === "bonus") holderRequests++;
        const q = url.searchParams.get("q") || "";
        if (url.searchParams.get("section") === "manual") searches.push(q);
        if (q === "older")
          await new Promise((resolve) => setTimeout(resolve, 900));
        data = {
          posts: empty
            ? []
            : q
              ? [{ ...posts[0], text: `Result for ${q}` }]
              : posts,
          next: null,
        };
      } else if (path.startsWith("/api/social/post/"))
        data = { post: posts[0], comments: [] };
      else if (path === "/api/social/leaderboard")
        data = {
          members: [
            { id: "viewer", username: "member", avatar: null, points: 100 },
          ],
        };
      else if (path === "/api/social/casts")
        data = {
          casts: [
            {
              hash: posts[0].cast_hash,
              text: "A recent original cast",
              timestamp: new Date().toISOString(),
            },
          ],
        };
      else if (path === "/api/social/view/start") data = { id: null };
      else if (path === "/api/social/report" && failReport) {
        status = 503;
        data = { error: "Please retry this report" };
      }
      if (route.request().method() === "POST") actions.push(path);
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    });
    await page.goto(base + "/social");
    await page.getByRole("heading", { name: "#1 FEED FOR CRYPTO" }).waitFor();
    await page.getByRole("button", { name: "Connect", exact: true }).waitFor();
    await page.locator(".social-post").first().waitFor();
    await page
      .getByText("Image unavailable. Open attachment", { exact: true })
      .first()
      .waitFor();
    assert(
      (await page.locator(".social-post").first().boundingBox()).y < 844,
      "First post must begin in the opening viewport",
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({ path: output + `aligned-feed-${width}.png` });
    const searchInput = page.getByPlaceholder("Search posts, tokens, users...");
    const orderBox = await page
      .getByRole("button", { name: "Order: Trending" })
      .boundingBox();
    const searchBox = await searchInput.boundingBox();
    assert(
      Math.abs(searchBox.y - orderBox.y) < 2,
      "Order and search must share a row",
    );
    assert.equal(
      await page.getByRole("button", { name: "Search", exact: true }).count(),
      0,
    );
    const initialSearches = searches.length;
    await searchInput.fill("tok");
    await searchInput.fill("tokens");
    await page.getByText("Result for tokens", { exact: true }).waitFor();
    assert.deepEqual(
      searches.slice(initialSearches),
      ["tokens"],
      "Typing must be debounced",
    );
    const olderRequest = page.waitForRequest((r) =>
      r.url().includes("q=older"),
    );
    await searchInput.fill("older");
    await olderRequest;
    await searchInput.fill("newer");
    await page.getByText("Result for newer", { exact: true }).waitFor();
    await page.waitForTimeout(950);
    assert.equal(
      await page.getByText("Result for older", { exact: true }).count(),
      0,
      "Stale responses must not replace current results",
    );
    await searchInput.fill("");
    await page
      .getByText("Image unavailable. Open attachment", { exact: true })
      .first()
      .waitFor();

    await page.getByRole("button", { name: "Order: Trending" }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Order: Points" }).waitFor();
    await page.locator(".social-compose-prompt").click();
    await page.getByRole("dialog").waitFor();
    await page.locator(".web-connect-provider-icon").first().waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll("img.web-connect-provider-icon")].every(
        (img) => img.complete && img.naturalWidth > 0,
      ),
    );
    await page.getByRole("button", { name: "Close connect modal" }).click();
    signed = true;
    fc = true;
    await page.reload();
    await page
      .getByRole("button", { name: "Open account menu", exact: true })
      .waitFor();
    await page.locator(".social-compose-prompt").click();
    let modal = page.getByRole("dialog", { name: "Your daily spotlight" });
    await modal.waitFor().catch(async (e) => {
      await page.screenshot({ path: output + "ui-failure.png" });
      console.log(await page.locator("body").innerText());
      throw e;
    });
    await page.locator(".social-account-fallback").waitFor();
    assert.equal(
      await page
        .getByLabel("Your post")
        .evaluate((el) => getComputedStyle(el).fontSize),
      "16px",
      "Composer input must avoid iOS focus zoom",
    );
    await page.getByLabel("Your post").fill("My draft stays here.");
    await page.keyboard.press("Escape");
    await page.locator(".social-compose-prompt").click();
    assert.equal(
      await page.getByLabel("Your post").inputValue(),
      "My draft stays here.",
    );
    await page.setViewportSize({ width, height: 420 });
    await page.getByLabel("Your post").focus();
    const footer = await modal.locator(".app-modal-footer").boundingBox();
    assert(
      footer.y + footer.height <= 420,
      "Modal action footer must remain in the short viewport",
    );
    await page.screenshot({
      path: output + `aligned-composer-short-${width}.png`,
    });
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole("button", { name: "Choose a recent cast" }).click();
    await page.getByRole("dialog", { name: "Choose a recent cast" }).waitFor();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    assert.equal(
      await page.getByLabel("Your post").inputValue(),
      "My draft stays here.",
    );
    await page.keyboard.press("Escape");
    const card = page.locator(".social-post").first();
    await card.getByRole("button", { name: "Quote post", exact: true }).click();
    await page.getByRole("dialog", { name: "Quote post" }).waitFor();
    await page.getByLabel("Quote text").fill("A useful perspective");
    await page.screenshot({ path: output + `aligned-quote-${width}.png` });
    await page.keyboard.press("Escape");
    await card.locator("summary").click();
    await card.getByRole("button", { name: "Report", exact: true }).click();
    failReport = true;
    await page.getByLabel("Reason").fill("A meaningful report reason");
    await page.getByRole("button", { name: "Submit report" }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Please retry this report" })
      .waitFor();
    failReport = false;
    await page.getByRole("button", { name: "Submit report" }).click();
    await page
      .getByRole("dialog", { name: "Report post" })
      .waitFor({ state: "hidden" });
    await page.locator(".social-post").nth(3).scrollIntoViewIfNeeded();
    const scroll = await page.evaluate(() => scrollY);
    await page
      .locator(".social-post")
      .nth(3)
      .getByRole("button", { name: "Read comments" })
      .click();
    await page.getByRole("heading", { name: "Conversation" }).waitFor();
    await page.goBack();
    await page.waitForTimeout(250);
    assert(
      await page.evaluate(
        () => Math.abs(scrollY - Math.min(history.state.socialScroll, Math.max(0, document.documentElement.scrollHeight - innerHeight))) < 8,
      ),
      `Feed scroll must be restored: ${JSON.stringify(await page.evaluate(() => ({ actual: scrollY, saved: history.state.socialScroll, maximum: document.documentElement.scrollHeight - innerHeight })))}, before click: ${scroll}`,
    );
    await page.getByRole("button", { name: "Rewards", exact: true }).click();
    await page.getByRole("heading", { name: "Show up. Level up." }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Refresh", exact: true })
        .evaluate((el) => getComputedStyle(el).fontSize),
      "12px",
    );
    assert.equal(
      await page
        .getByLabel("Email address", { exact: true })
        .evaluate((el) => getComputedStyle(el).fontSize),
      "16px",
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Join Waitlist", exact: true })
        .evaluate((el) => getComputedStyle(el).fontSize),
      "14px",
    );
    await page.screenshot({ path: output + `aligned-rewards-${width}.png` });
    await page
      .getByRole("button", { name: "Leaderboard", exact: true })
      .click();
    await page.reload();
    await page.getByRole("heading", { name: "Attention earned." }).waitFor();
    await page
      .getByRole("button", { name: "Open account menu", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "About Social" }).click();
    await page.reload();
    await page
      .getByRole("heading", {
        name: "Distribution rules everything around me.",
      })
      .waitFor();
    await page
      .getByRole("button", { name: "Open account menu", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "View onboarding" }).click();
    await page
      .getByRole("dialog", { name: "One post. A real shot." })
      .waitFor();
    await page
      .getByRole("button", { name: "Go to onboarding slide 3" })
      .click();
    await page
      .getByRole("button", { name: "Explore the feed", exact: true })
      .click();
    if (width === 390) {
      await page.goto(base + "/social?page=admin");
      await page
        .getByLabel("Admin key", { exact: true })
        .fill("browser-only-fixture");
      await page.getByRole("button", { name: "Load administration" }).click();
      await page
        .getByRole("button", { name: "Suspend linked identities" })
        .click();
      await page.getByRole("dialog", { name: "Moderation action" }).waitFor();
      await page
        .getByLabel("Reason", { exact: true })
        .fill("Browser-only moderation fixture");
      await page
        .getByRole("button", { name: "Save action", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "Moderation action" })
        .waitFor({ state: "hidden" });
    }
    empty = true;
    await page.goto(base + "/social");
    await page.getByText("The next big idea starts here.").waitFor();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.equal(holderRequests, 0, "The app must not request a holder feed");
    assert.equal(
      await page.getByText("From the Warplets", { exact: true }).count(),
      0,
    );
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "Social UI checks passed at 320/390/1280: compact feed, authentication prompt, draft retention, short viewport, cast picker, quote/report, keyboard dropdown, history/scroll, rewards, onboarding and empty states. API interactions used browser-only fixtures.",
  );
} finally {
  await browser.close();
}
