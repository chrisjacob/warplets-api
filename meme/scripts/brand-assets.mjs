import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { rasterScene } from "./render-share.mjs";
globalThis.fetch = async () => {
  throw Error("Brand rendering must remain offline");
};
const out = resolve(import.meta.dirname, "../public");
const mark =
  "data:image/png;base64," +
  readFileSync(new URL("./assets/brand-mark.png", import.meta.url)).toString(
    "base64",
  );
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
          backgroundColor: "#000000",
          padding: icon ? 0 : 72,
          display: "flex",
          flexDirection: "column",
          justifyContent: icon ? "center" : "space-between",
          alignItems: icon ? "center" : "flex-start",
          fontFamily: "Inter",
        },
        children: icon
          ? [{ type: "img", props: { src: mark, width: 512, height: 512 } }]
          : [
              text("10X.MEME", 90, "#00ff00"),
              text("One launch. Or skip.", 66, "#efffef"),
              text(
                "Vote for an OG. Follow the launch. Claim rewards.",
                30,
                "#b8d7b8",
              ),
              text("Solana · Warplets · Farcaster", 26, "#91b491"),
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
