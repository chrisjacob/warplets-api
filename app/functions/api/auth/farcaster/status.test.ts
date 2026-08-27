import { describe, expect, it } from "vitest";
import { onRequestPost } from "./status.js";

function request(body: unknown): Request {
  return new Request("https://warplet.10x.meme/api/auth/farcaster/status", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://warplet.10x.meme",
    },
    body: JSON.stringify(body),
  });
}

describe("Farcaster status recovery", () => {
  it("returns idle when no channel or recovery cookie exists", async () => {
    const response = await onRequestPost({
      request: request({}),
      env: {},
    } as Parameters<typeof onRequestPost>[0]);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ state: "idle" });
  });

  it("continues rejecting malformed explicit channel tokens", async () => {
    const response = await onRequestPost({
      request: request({ channelToken: "bad" }),
      env: {},
    } as Parameters<typeof onRequestPost>[0]);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Farcaster sign-in channel is invalid" });
  });
});
