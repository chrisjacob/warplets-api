import { describe, expect, it, vi } from "vitest";
import { captureHolderOutreachAttribution, getHolderOutreachTrackingCode } from "./outreachAttribution";

describe("holder outreach attribution", () => {
  it("reads only valid opaque tracking codes", () => {
    expect(getHolderOutreachTrackingCode(new URL(`https://warplet.10x.meme/?outreach=${"a".repeat(32)}`)))
      .toBe("a".repeat(32));
    expect(getHolderOutreachTrackingCode(new URL("https://warplet.10x.meme/?outreach=short"))).toBeNull();
  });

  it("records a browser open once per session", () => {
    const values = new Map<string, string>();
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const browser = {
      location: { href: `https://warplet.10x.meme/?outreach=${"b".repeat(32)}` },
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
      fetch,
    } as unknown as Pick<Window, "location" | "sessionStorage" | "fetch">;

    captureHolderOutreachAttribution(browser);
    captureHolderOutreachAttribution(browser);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
