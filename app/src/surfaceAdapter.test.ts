import { afterEach, describe, expect, it, vi } from "vitest";

const sdkMocks = vi.hoisted(() => ({
  openUrl: vi.fn(),
}));

vi.mock("@farcaster/miniapp-sdk", () => ({
  default: {
    actions: {
      openUrl: sdkMocks.openUrl,
      ready: vi.fn(),
      viewProfile: vi.fn(),
      composeCast: vi.fn(),
      addMiniApp: vi.fn(),
    },
    wallet: { getEthereumProvider: vi.fn() },
  },
}));

import { configureAppSurface, openAppUrl } from "./surfaceAdapter";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  configureAppSurface("web");
});

describe("external URL navigation", () => {
  it("opens one isolated tab without replacing the current page", async () => {
    const anchor = { href: "", target: "", rel: "", click: vi.fn(), remove: vi.fn() };
    const appendChild = vi.fn();
    const createElement = vi.fn(() => anchor);
    vi.stubGlobal("document", { createElement, body: { appendChild } });
    configureAppSurface("web");

    await openAppUrl("https://warplet.10x.meme/image.png");

    expect(createElement).toHaveBeenCalledWith("a");
    expect(anchor).toMatchObject({
      href: "https://warplet.10x.meme/image.png",
      target: "_blank",
      rel: "noopener noreferrer",
    });
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.remove).toHaveBeenCalledOnce();
  });

  it("keeps native Farcaster URL handling inside the Mini App", async () => {
    configureAppSurface("farcaster-miniapp");
    await openAppUrl("https://warplet.10x.meme/image.png");
    expect(sdkMocks.openUrl).toHaveBeenCalledWith("https://warplet.10x.meme/image.png");
  });
});
