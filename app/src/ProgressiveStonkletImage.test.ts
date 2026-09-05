import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import ProgressiveStonkletImage, { stonkletThumbnail } from "./ProgressiveStonkletImage";
describe("progressive Stonklet artwork", () => {
 it("uses a 512px thumbnail, covering 3x the largest 168px token icon", () => {
  expect(512).toBeGreaterThanOrEqual(168 * 3);
  expect(stonkletThumbnail("/stonklets/stonklets/Arrow.webp")).toBe("/stonklets/stonklets/thumbs/512/Arrow.webp");
 });
 it("preserves origin and query parameters and leaves other images alone", () => {
  expect(stonkletThumbnail("https://stonklet.10x.meme/stonklets/stonklets/Arrow.webp?retry=1")).toBe("https://stonklet.10x.meme/stonklets/stonklets/thumbs/512/Arrow.webp?retry=1");
  expect(stonkletThumbnail("/hero_stonklet.jpg")).toBe("/hero_stonklet.jpg");
 });
 it("initially requests only the lazy thumbnail, preserving the full-resolution load for later", () => {
  const html=renderToStaticMarkup(createElement(ProgressiveStonkletImage,{src:"/stonklets/stonklets/Arrow.webp",alt:"Arrow"}));
  expect(html).toContain('src="/stonklets/stonklets/thumbs/512/Arrow.webp"');
  expect(html).not.toContain('src="/stonklets/stonklets/Arrow.webp"');
  expect(html).toContain('loading="lazy"');
 });
});
