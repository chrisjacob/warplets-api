import test from "node:test";
import assert from "node:assert/strict";
import { cardPage, type ShareCard } from "./shareCards";
test("crawler metadata escapes all dynamic text and pins immutable images with matching ratios", () => {
  const card: ShareCard = {
    version: 1,
    id: "a".repeat(64),
    kind: "pnl",
    subject: "trading",
    window: "24h",
    fid: 42,
    title: '<script>alert("x")</script>',
    lines: ['" onload="x'],
    asOf: 1000,
    mode: "simulated",
    sourceHash: "b".repeat(64),
    targetPath: "/?view=Leaders",
  };
  const html = cardPage(card, "https://example.com");
  assert(!html.includes("<script>"));
  assert(!html.includes('content="" onload='));
  assert(html.includes("fc:miniapp"));
  assert(html.includes("/mini.png"));
  assert(html.includes("/og.png"));
  assert(html.includes("SIMULATED") || html.includes("Simulated"));
  assert.throws(
    () =>
      cardPage(
        { ...card, targetPath: "https://evil.example/" },
        "https://example.com",
      ),
    /stay in app/,
  );
});
