import { describe, expect, it, vi } from "vitest";
import { onRequestGet } from "./chart";
vi.mock("../../_lib/stonkletMarket.js", () => ({ loadChart: vi.fn(async () => ({ points: [], status: "unavailable" })) }));

describe("Stonklets chart API validation", () => {
  it("rejects unsupported chart ranges", async () => {
    const response = await onRequestGet({ request: new Request("https://stonklet.10x.meme/api/stonklets/chart?pair=robinhood&asset=stock&range=5m") } as never) as Response;
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid range" });
  });

  it("validates an allowlisted pair before loading a provider", async () => {
    const response = await onRequestGet({ request: new Request("https://stonklet.10x.meme/api/stonklets/chart?pair=unknown&asset=stock&range=24h") } as never) as Response;
    expect(response.status).toBe(404);
  });
});

it("does not cache unavailable provider data as a successful chart", async () => {
 const response = await onRequestGet({ request: new Request("https://stonklet.10x.meme/api/stonklets/chart?pair=nvidia&asset=stock&range=24h"), env: {} } as never) as Response;
 expect(response.status).toBe(503);
 expect(response.headers.get("cache-control")).toBe("no-store");
 expect(response.headers.get("retry-after")).toBe("10");
});
