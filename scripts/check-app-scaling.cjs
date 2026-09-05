// Run against a local app dev server: node scripts/check-app-scaling.cjs
// Optional: APP_TEST_URL=http://127.0.0.1:5177 CHROME_PATH=/path/to/chrome
// Uses an isolated browser profile; no wallet connection or transaction is made.
const assert = require("node:assert/strict");
const puppeteer = require("../app/node_modules/@cloudflare/puppeteer/lib/cjs/puppeteer/puppeteer-core.js");

const baseUrl = process.env.APP_TEST_URL || "http://127.0.0.1:5177";
assert(["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname), "Use a local dev server");

async function main() {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    timeout: 15000,
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewport({ width: 1000, height: 600 });
    await page.goto(`${baseUrl}/stonklets`);
    await page.waitForSelector('[role="alertdialog"]');
    assert(await page.$eval('[role="alertdialog"] footer', (element) => {
      const rect = element.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight;
    }), "Notice actions remain visible in a short viewport");
    await page.click('input[type="checkbox"]');
    await page.click('[role="alertdialog"] button');

    for (const route of ["/stonklets", "/warplets", "/drop", "/"]) {
      await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".miniapp-header");
      if (route === "/warplets") {
        await page.waitForSelector('[aria-label="Go to onboarding slide 7"]');
        await page.click('[aria-label="Go to onboarding slide 7"]');
        for (const button of await page.$$("#app-overlays button")) {
          if (await button.evaluate((element) => element.innerText === "Done")) await button.click();
        }
        await page.waitForSelector('[aria-label="Go to onboarding slide 7"]', { hidden: true });
      }

      for (const width of [390, 500, 501, 600, 750, 1000, 1600]) {
        await page.setViewport({ width, height: 900 });
        await page.waitForFunction((expected) => Math.abs(document.querySelector(".miniapp-shell__inner").getBoundingClientRect().width - expected) < 1, {}, Math.min(width, 750));
        const geometry = await page.evaluate(() => {
          const rect = document.querySelector(".miniapp-shell__inner").getBoundingClientRect();
          return {
            left: rect.left, width: rect.width, height: rect.height,
            layoutWidth: document.querySelector(".miniapp-shell__inner").offsetWidth,
            shellHeight: document.querySelector(".miniapp-shell").getBoundingClientRect().height,
            scrollWidth: document.documentElement.scrollWidth,
          };
        });
        assert.equal(geometry.layoutWidth, Math.min(width, 500));
        assert(Math.abs(geometry.left - (width - geometry.width) / 2) < 1, `${route}: centered at ${width}px`);
        assert(geometry.scrollWidth <= width, `${route}: no horizontal overflow`);
        assert(Math.abs(geometry.height - geometry.shellHeight) < 2, `${route}: scaled document height`);
      }

      await page.setViewport({ width: 1000, height: 900 });
      if (route !== "/drop") {
        await page.click(".miniapp-header__title-badge");
        await page.waitForSelector('[role="menu"]');
        assert(await page.$eval('[role="menu"]', (element) => {
          const rect = element.getBoundingClientRect();
          return Math.abs(rect.left + rect.width / 2 - innerWidth / 2) < 1;
        }), "Account menu is centered");
        await page.click('[role="menu"] [role="menuitem"]');
        await page.waitForSelector(".web-connect-modal");
        for (const width of [1000, 600, 390]) {
          await page.setViewport({ width, height: 600 });
          await page.waitForFunction(() => {
            const rect = document.querySelector(".web-connect-modal").getBoundingClientRect();
            return rect.top >= 0 && rect.bottom <= innerHeight + 1 && rect.left >= 0 && rect.right <= innerWidth + 1;
          });
        }
        if (route === "/") {
          await page.setViewport({ width: 1000, height: 600 });
          await page.waitForSelector(".web-connect-modal [data-overlayscrollbars-viewport]");
          const viewport = await page.$(".web-connect-modal [data-overlayscrollbars-viewport]");
          const rect = await viewport.boundingBox();
          await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
          await page.mouse.wheel({ deltaY: 300 });
          await page.waitForFunction(() => document.querySelector(".web-connect-modal [data-overlayscrollbars-viewport]").scrollTop > 0);
          console.log("PASS internal custom scrolling in a scaled dialog");
        }
        await page.click('[aria-label="Close connect modal"]');
        await page.waitForSelector(".web-connect-modal", { hidden: true });
      }

      await page.setViewport({ width: 1000, height: 900 });
      await page.click('[aria-label="Open menu"]');
      await page.waitForSelector(".miniapp-menu-page");
      await page.mouse.move(800, 600);
      await page.mouse.wheel({ deltaY: 600 });
      await page.waitForFunction(() => window.scrollY > 0);
      assert(await page.evaluate(() => !!document.querySelector(".os-scrollbar-vertical")), "Custom scrollbar remains available");
      const scrollHeight = await page.evaluate(() => Math.abs(document.documentElement.scrollHeight - document.querySelector(".miniapp-shell").getBoundingClientRect().height));
      assert(scrollHeight < 2, "No blank space below the scaled page");
      if (route === "/") {
        const before = await page.evaluate(() => scrollY);
        const handle = await page.$(".os-scrollbar-vertical .os-scrollbar-handle");
        const rect = await handle.boundingBox();
        await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
        await page.mouse.down();
        await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2 + 60, { steps: 10 });
        await page.mouse.up();
        await page.waitForFunction((previous) => scrollY > previous, {}, before);
        console.log("PASS custom page scrollbar dragging");
      }
      console.log(`PASS ${route}: seven widths, centering, page height, menus, scrolling${route !== "/drop" ? ", desktop/mobile dialog resizing" : ""}`);
    }

    await page.goto(`${baseUrl}/stonklets`);
    await page.waitForSelector('input[type="search"]');
    await page.type('input[type="search"]', "SpaceX");
    await page.waitForFunction(() => document.querySelectorAll(".stonklets-pair").length === 1);
    await page.click(".stonklets-dropdown-trigger");
    await page.waitForSelector('[role="listbox"]');
    await page.click('[role="listbox"] button:last-child');
    await page.click('[aria-label^="Change results layout"]');
    await page.waitForSelector(".stonklets-chart-pair");
    console.log("PASS Stonklet search, market selection, and chart layout switch");

    // Exercise native sticky layout with the real shell and body scrollbar,
    // independently of whether today's market data contains a sticky group.
    await page.goto(`${baseUrl}/drop`);
    await page.waitForSelector(".miniapp-shell__content");
    await page.evaluate(() => {
      const probe = document.createElement("section");
      probe.style.height = "1800px";
      probe.innerHTML = '<div style="height:200px"></div><div id="scaling-sticky-probe" class="sticky top-0" style="height:40px">Sticky layout probe</div>';
      document.querySelector(".miniapp-shell__content").prepend(probe);
      window.scrollTo(0, 600);
    });
    await page.waitForFunction(() => Math.abs(document.querySelector("#scaling-sticky-probe").getBoundingClientRect().top) < 1);
    console.log("PASS sticky positioning while the scaled page scrolls");

    await page.goto(`${baseUrl}/warplets/perks`);
    await page.waitForSelector("button.cursor-help", { timeout: 45000 });
    await page.hover("button.cursor-help");
    await page.waitForSelector('[role="tooltip"]');
    assert(await page.$eval('[role="tooltip"]', (element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1
        && Math.abs(rect.width / element.offsetWidth - 1.5) < 0.02;
    }), "Floating tooltip is scaled and inside the viewport");
    console.log("PASS floating tooltip placement and scaling");
    assert.deepEqual(errors, [], "No browser runtime errors");
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
