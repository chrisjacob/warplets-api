import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { rasterScene } from "./render-share.mjs";
globalThis.fetch = async () => {
  throw Error("Brand rendering must remain offline");
};
const out = resolve(import.meta.dirname, "../public");
mkdirSync(out, { recursive: true });
const text = (value, size, color) => ({
  type: "div",
  props: { style: { display: "flex", fontSize: size, color }, children: value },
});
for (const [name, width, height] of [
  ["icon", 512, 512],
  ["social-mini", 1200, 800],
  ["social-og", 1200, 630],
]) {
  const icon = name === "icon",
    tree = {
      type: "div",
      props: {
        style: {
          width,
          height,
          backgroundColor: "#101512",
          padding: icon ? 32 : 72,
          display: "flex",
          flexDirection: "column",
          justifyContent: icon ? "center" : "space-between",
          alignItems: icon ? "center" : "flex-start",
          fontFamily: "Inter",
        },
        children: icon
          ? [text("10X", 150, "#d6fd72")]
          : [
              text("10X.meme", 90, "#d6fd72"),
              text("One launch. Or skip.", 66, "#edf8ec"),
              text(
                "Vote for an OG. Follow the launch. Claim rewards.",
                30,
                "#bbcebd",
              ),
              text("Solana · Warplets · Farcaster", 26, "#9eb19f"),
            ],
      },
    };
  writeFileSync(
    resolve(out, name + ".png"),
    await rasterScene(tree, width, height),
  );
}
console.log(
  "Prepared local icon and both root social PNGs; no manifest or app registration published.",
);
