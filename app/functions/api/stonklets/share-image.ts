import { allowStonkletAction, fetchRenderAvatar } from "../../_lib/stonkletAbuse.js";
import { claimStonkletWork, releaseStonkletWork } from "../../_lib/stonkletWorkLease.js";
import { Buffer } from "node:buffer";
import { STONKLETS_BY_ID } from "../../../shared/stonkletsCatalog.js";
import { isStonkletsAppHostname } from "../../../shared/stonkletsApp.js";
import { parseStonkletChangeRange } from "../../../shared/stonkletsTime.js";
import { buildStatsShareOgDocument, type StatsSharesEnv } from "../../_lib/statsShares.js";
import { jsonSecure } from "../../_lib/security.js";

const CACHE_SECONDS = 300;
export const onRequestGet: PagesFunction<StatsSharesEnv> = async (context) => {
  const url = new URL(context.request.url);
  const entry = STONKLETS_BY_ID.get(url.searchParams.get("id") ?? "");
  if (!entry || !isStonkletsAppHostname(url.hostname)) return jsonSecure({ error: "Unknown Stonklet" }, { status: 404 });
  const range = parseStonkletChangeRange(url.searchParams.get("range")) ?? "24h";
  const variant = url.searchParams.get("variant") === "og" ? "og" : "square";
  const prefix = `stonklet-shares/v5/${url.hostname}/${entry.id}/${range}`;
  const key = `${prefix}-${variant}.png`;
  const images = context.env.STATS_SHARE_IMAGES;
  if (!images || !context.env.STATS_SHARE_BROWSER) return jsonSecure({ error: "Share image rendering is unavailable" }, { status: 503 });
  const headers = { "content-type": "image/png", "cache-control": `public, max-age=${CACHE_SECONDS}`, "x-content-type-options": "nosniff" };
  const cached = await images.get(key);
  if (cached && Date.now() - cached.uploaded.getTime() < CACHE_SECONDS * 1000) return new Response(cached.body, { headers });
  const owner = await claimStonkletWork(context.env.WARPLETS, prefix, 180);
  if (!owner) {
    // Social crawlers also need an image response; wait for the existing render
    // without starting another browser. The modal can retry a bounded timeout.
    for (let attempt = 0; attempt < 45; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const completed = await images.get(key);
      if (completed && Date.now() - completed.uploaded.getTime() < CACHE_SECONDS * 1000) return new Response(completed.body, { headers });
      if (context.request.signal.aborted) break;
    }
    return jsonSecure({ status: "rendering" }, { status: 202, headers: { "retry-after": "2", "cache-control": "no-store" } });
  }
  let browser: Awaited<ReturnType<typeof import("@cloudflare/puppeteer")["launch"]>> | undefined;
  try {
    // Another request may have completed between the first cache check and lease acquisition.
    const completed = await images.get(key);
    if (completed && Date.now() - completed.uploaded.getTime() < CACHE_SECONDS * 1000) return new Response(completed.body, { headers });
    const ip = context.request.headers.get("cf-connecting-ip") ?? "unknown";
    if (!await allowStonkletAction(context.env.WARPLETS, "render-ip", ip, 5)
      || !await allowStonkletAction(context.env.WARPLETS, "render-global", "all", 20)) {
      return jsonSecure({ error: "Too many chart renders. Please retry in a minute." }, { status: 429, headers: { "retry-after": "60" } });
    }
    const puppeteer = await import("@cloudflare/puppeteer");
    browser = await puppeteer.launch(context.env.STATS_SHARE_BROWSER as Parameters<typeof puppeteer.launch>[0]);
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    let avatarRequests = 0;
    page.on("request", (request) => {
      void (async () => {
        const target = new URL(request.url());
        if (target.origin === `https://${url.hostname}` || target.protocol === "data:" || target.protocol === "blob:") {
          await request.continue(); return;
        }
        // External scripts, documents, redirects and arbitrary profile destinations are blocked.
        if (request.resourceType() === "image" && ++avatarRequests <= 10) {
          const body = await fetchRenderAvatar(request.url());
          if (body) { await request.respond({ status: 200, body: Buffer.from(body) }); return; }
        }
        await request.abort();
      })().catch(() => request.abort().catch(() => undefined));
    });
    await page.setViewport({ width: 1000, height: 1000, deviceScaleFactor: 1 });
    const renderUrl = `https://${url.hostname}/stonklets?shareRender=${encodeURIComponent(entry.id)}&change=${range}`;
    await page.goto(renderUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForSelector('[data-stonklet-share-ready="true"]', { timeout: 45_000 });
    await page.evaluate(async () => {
      for (const image of document.images) image.loading = "eager";
      await Promise.race([
        Promise.all([document.fonts.ready, ...Array.from(document.images).map((image) => image.decode().catch(() => undefined))]),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    });
    // Recheck after image/font work: deferred charts may have restarted while
    // layout settled. Require a stable ready window and then let canvas paint.
    await page.waitForFunction(() => {
      const root = document.querySelector('[data-stonklet-share-ready="true"]');
      const ready = root && !root.querySelector('.stonklets-chart-loading,[data-artwork-ready="false"],[data-voters-ready="false"]')
        && Array.from(document.images).every(image => image.complete)
        && document.fonts.status === "loaded";
      const state = document.documentElement;
      if (!ready) { delete state.dataset.shareStableAt; return false; }
      const started = Number(state.dataset.shareStableAt || Date.now());
      state.dataset.shareStableAt = String(started);
      return Date.now() - started >= 750;
    }, { timeout: 30_000, polling: 100 });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const square = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1000, height: 1000 } });
    await images.put(`${prefix}-square.png`, square, { httpMetadata: { contentType: "image/png" } });
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    await page.setContent(buildStatsShareOgDocument(`data:image/png;base64,${Buffer.from(square).toString("base64")}`));
    await page.evaluate(async () => { await Promise.race([Promise.all(Array.from(document.images).map((image) => image.decode())), new Promise((resolve) => setTimeout(resolve, 5000))]); });
    const og = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1200, height: 630 } });
    await images.put(`${prefix}-og.png`, og, { httpMetadata: { contentType: "image/png" } });
    return new Response(new Uint8Array(variant === "og" ? og : square), { headers });
  } catch (error) {
    console.error("stonklet_share_render_failed", { id: entry.id, error: error instanceof Error ? error.message : String(error) });
    return jsonSecure({ error: "Couldn't render this Stonklet. Please retry." }, { status: 503 });
  } finally {
    await browser?.close().catch(() => undefined);
    await releaseStonkletWork(context.env.WARPLETS, prefix, owner);
  }
};
