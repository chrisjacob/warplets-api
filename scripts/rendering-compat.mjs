/** Isolated renderer: each Snap version owns a resvg singleton. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
assert(["../package.json", "../snap/package.json"].includes(process.argv[2]));
const root = createRequire(new URL("../package.json", import.meta.url));
const fromApp = createRequire(new URL(process.argv[2], import.meta.url));
const wrapper = fromApp.resolve("@farcaster/snap-hono");
const fromWrapper = createRequire(wrapper);
const fontPath = root.resolve(
  "@fontsource/inter/files/inter-latin-400-normal.woff",
);
const bytes = readFileSync(fontPath);
const font = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
assert.match(
  fromWrapper.resolve("satori").replaceAll("\\", "/"),
  /satori@0\.33\.5/,
);
globalThis.fetch = async () => {
  throw Error("Rendering must stay offline");
};
const satori = fromWrapper("satori").default;
const malicious = '<script>alert("x")</script>&<img onerror="x">';
const svg = await satori(
  {
    type: "div",
    props: {
      style: { display: "flex", backgroundColor: "#101512", color: "#00ff00" },
      children: malicious,
    },
  },
  {
    width: 508,
    height: 240,
    fonts: [{ name: "Inter", data: font, weight: 400, style: "normal" }],
  },
);
assert(svg.startsWith("<svg"));
assert(!svg.includes("<script>"));
assert(!svg.includes("<img onerror"));
const { renderSnapPageToPng } = await import(
  pathToFileURL(join(dirname(wrapper), "og-image.js")).href
);
const page = {
  ui: {
    root: "root",
    elements: {
      root: { type: "stack", children: ["title", "text"] },
      title: { type: "heading", props: { text: "10X Daily Launchpad" } },
      text: { type: "text", props: { text: malicious } },
    },
  },
};
const png = Buffer.from(
  await renderSnapPageToPng(page, {
    width: 508,
    height: 300,
    fonts: [{ path: fontPath, weight: 400 }],
  }),
);
assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
assert.equal(png.readUInt32BE(16), 508);
assert.equal(png.readUInt32BE(20), 300);
console.log("Offline PNG compatibility verified");
