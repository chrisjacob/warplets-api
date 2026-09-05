import { describe, expect, it } from "vitest";
import { isStonkletsFlapPreview } from "./stonkletsFlapPreview";

describe("local Flap preview", () => {
  it.each(["localhost:5177", "127.0.0.1:8792", "[::1]:5177", "stonklet-local.10x.meme", "app-local.10x.meme"])("allows explicit opt-in on %s", (host) => {
    expect(isStonkletsFlapPreview(new URL(`http://${host}/?flap=1`))).toBe(true);
    expect(isStonkletsFlapPreview(new URL(`http://${host}/`))).toBe(false);
    expect(isStonkletsFlapPreview(new URL(`http://${host}/?flap=0`))).toBe(false);
  });
  it.each(["stonklet.10x.meme", "stonklet-dev.10x.meme", "app.10x.meme", "evil-local.example", "localhost.example"])("ignores preview on %s", (host) => {
    expect(isStonkletsFlapPreview(new URL(`https://${host}/?flap=1`))).toBe(false);
  });
});
