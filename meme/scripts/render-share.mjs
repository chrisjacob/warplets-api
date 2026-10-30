/** Offline operator renderer. Uses the existing patched Satori/resvg stack, never remote fonts/images. */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = createRequire(new URL("../../package.json", import.meta.url)),
  wrapper = createRequire(root.resolve("@farcaster/snap-hono"));
let init;
export async function renderCard(card, height) {
  if (
    ![630, 800].includes(height) ||
    !card ||
    card.version !== 1 ||
    typeof card.title !== "string" ||
    card.title.length > 150 ||
    !Array.isArray(card.lines) ||
    card.lines.length > 4 ||
    card.lines.some((l) => typeof l !== "string" || l.length > 250) ||
    !Number.isSafeInteger(card.asOf) ||
    !["simulated", "observed"].includes(card.mode) ||
    !/^[a-f0-9]{64}$/.test(card.sourceHash)
  )
    throw Error("Invalid server card");
  const { Resvg, initWasm } = wrapper("@resvg/resvg-wasm");
  await (init ??= initWasm(
    readFileSync(wrapper.resolve("@resvg/resvg-wasm/index_bg.wasm")),
  ));
  const font = readFileSync(
    root.resolve("@fontsource/inter/files/inter-latin-400-normal.woff"),
  );
  const fontData = font.buffer.slice(
    font.byteOffset,
    font.byteOffset + font.byteLength,
  );
  const satori = wrapper("satori").default;
  const div = (text, style = {}) => ({
    type: "div",
    props: { style: { display: "flex", ...style }, children: text },
  });
  const tree = {
    type: "div",
    props: {
      style: {
        width: 1200,
        height,
        backgroundColor: "#0e1712",
        color: "#edf8ec",
        padding: 64,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        fontFamily: "Inter",
      },
      children: [
        div("10X.meme", { fontSize: 38, color: "#d6fd72" }),
        div(card.title, { fontSize: 58, lineHeight: 1.2 }),
        ...card.lines.map((l) => div(l, { fontSize: 26, color: "#bbcebd" })),
        div(
          (card.mode === "simulated" ? "SIMULATED · " : "") +
            new Date(card.asOf).toISOString().replace("T", " ").slice(0, 19) +
            " UTC",
          { fontSize: 22 },
        ),
        div(
          "Past performance does not predict returns. · " +
            card.sourceHash.slice(0, 12),
          { fontSize: 18, color: "#9eb19f" },
        ),
      ],
    },
  };
  const svg = await satori(tree, {
    width: 1200,
    height,
    fonts: [{ name: "Inter", data: fontData, weight: 400, style: "normal" }],
  });
  const renderer = new Resvg(svg);
  try {
    const rendered=renderer.render();try{return Buffer.from(rendered.asPng());}finally{rendered.free();}
  } finally {
    renderer.free();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const raw = readFileSync(process.argv[2]);
  if (raw.length > 10000) throw Error("Card input too large");
  const card = JSON.parse(raw),
    out = resolve(process.argv[3]);
  mkdirSync(out, { recursive: true });
  globalThis.fetch = async () => {
    throw Error("Card rendering must stay offline");
  };
  for (const [format, height] of [
    ["mini", 800],
    ["og", 630],
  ])
    writeFileSync(join(out, format + ".png"), await renderCard(card, height));
  console.log("Rendered offline PNG cards: 1200×800 and 1200×630");
}
