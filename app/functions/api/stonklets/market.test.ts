import { describe, expect, it } from "vitest";
import { onRequestGet } from "./market";

describe("Stonklets market API validation", () => {
  it("rejects an unsupported selected change range before accessing bindings", async () => {
    const response = await onRequestGet({ request: new Request("https://stonklet.10x.meme/api/stonklets/market?range=4h") } as never) as Response;
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid change range" });
  });
});
