import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
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
const appRequire = createRequire(
  new URL("../app/package.json", import.meta.url),
);
const { generatePrivateKey, privateKeyToAccount } = appRequire("viem/accounts");
const base = process.env.SOCIAL_TEST_ORIGIN || "http://127.0.0.1:8793";
const out = new URL("../.tmp/social-qa/", import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.SOCIAL_CHROME_PATH
    ? { executablePath: process.env.SOCIAL_CHROME_PATH }
    : { channel: "chrome" }),
});
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", async (r) => {
    if (r.url().includes("/api/social") && r.status() >= 400)
      console.log("Social API failure", r.status(), r.url(), await r.text());
  });
  await page.goto(`${base}/social`, { waitUntil: "networkidle" });
  await page.getByRole("dialog", { name: "One post. A real shot." }).waitFor();
  await page.screenshot({
    path: new URL("onboarding.png", out).pathname.replace(/^\/(\w:)/, "$1"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page
    .getByRole("button", { name: "Explore the feed", exact: true })
    .click();
  await page.getByRole("heading", { name: "#1 FEED FOR CRYPTO" }).waitFor();
  await page.screenshot({
    path: new URL("feed-mobile.png", out).pathname.replace(/^\/(\w:)/, "$1"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    "Mobile horizontal overflow",
  );
  // Authenticate a generated, unfunded QA wallet against the real local SIWE API.
  const account = privateKeyToAccount(generatePrivateKey());
  const challenge = await context.request.post(
    `${base}/api/auth/wallet/challenge`,
    {
      data: { address: account.address, chainId: 8453 },
      headers: { origin: base },
    },
  );
  assert.equal(challenge.status(), 200, await challenge.text());
  const { message } = await challenge.json();
  const signature = await account.signMessage({ message });
  const signed = await context.request.post(`${base}/api/auth/wallet/verify`, {
    data: { message, signature },
    headers: { origin: base },
  });
  assert.equal(signed.status(), 200, await signed.text());
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Open account menu", exact: true }).waitFor();
  await page.locator(".social-compose-prompt").click();
  await page.getByLabel("Your post").fill("Draft survives closing");
  await page.keyboard.press("Escape");
  await page.locator(".social-compose-prompt").click();
  assert.equal(
    await page.getByLabel("Your post").inputValue(),
    "Draft survives closing",
  );
  await page
    .getByLabel("Your post")
    .fill(
      "[Local QA] A focused feed gives original ideas room to be seen. https://10x.meme",
    );
  await page.getByRole("button", { name: "Post to 10X" }).click();
  await page
    .getByText("Your post is in the feed.", { exact: false })
    .waitFor()
    .catch(async (e) => {
      console.log(await page.locator("body").innerText());
      await page.screenshot({
        path: new URL("failure.png", out).pathname.replace(/^\/(\w:)/, "$1"),
        fullPage: true,
      });
      throw e;
    });
  const me = await (await context.request.get(`${base}/api/social/me`)).json();
  assert.equal(me.totals.points, 25);
  assert.ok(me.member.next_post_at > Date.now());
  await page.locator(".social-compose-prompt").click();
  assert(await page.getByRole("button", { name: "Post to 10X" }).isDisabled());
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open account menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "About Social" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Rewards", exact: true }).click();
  await page.getByRole("heading", { name: "Show up. Level up." }).waitFor();
  await page.screenshot({
    path: new URL("rewards-mobile.png", out).pathname.replace(/^\/(\w:)/, "$1"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Leaderboard", exact: true }).click();
  await page.getByRole("heading", { name: "Attention earned." }).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Attention earned." }).waitFor();
  await page.goBack();
  await page.getByRole("heading", { name: "Show up. Level up." }).waitFor();
  await page.goForward();
  await page.getByRole("heading", { name: "Attention earned." }).waitFor();
  await page.getByRole("button", { name: "Open account menu", exact: true }).click();
    await page.getByRole("menuitem", { name: "About Social" }).click();
  await page
    .getByRole("heading", { name: "Distribution rules everything around me." })
    .waitFor();
  await page.setViewportSize({ width: 1365, height: 1000 });
  await page.getByRole("button", { name: "Feed", exact: true }).click();
  await page.screenshot({
    path: new URL("feed-desktop.png", out).pathname.replace(/^\/(\w:)/, "$1"),
    fullPage: true,
  });
  const posts = await (
    await context.request.get(`${base}/api/social/feed`)
  ).json();
  const own = posts.posts.find((p) => p.member_id === me.member.id);
  assert.ok(own);
  await page.goto(`${base}/social/post/${own.id}`, {
    waitUntil: "networkidle",
  });
  await page
    .getByRole("heading", { name: "Conversation", exact: true })
    .waitFor();
  // Keep the shared local feed free of QA content after the test.
  const deleted = await context.request.post(`${base}/api/social/delete`, {
    data: { postId: own.id },
    headers: { origin: base },
  });
  assert.equal(deleted.status(), 200);
  await writeFile(
    new URL("browser-result.json", out),
    JSON.stringify(
      {
        passed: true,
        wallet: account.address,
        memberId: me.member.id,
        postId: own.id,
        errors,
      },
      null,
      2,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: mobile/desktop layout, onboarding, real wallet SIWE, posting, cooldown, points, rewards, leaderboard, about, deep link, deletion. Screenshots: .tmp/social-qa",
  );
} finally {
  await browser.close();
}
