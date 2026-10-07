import { beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestGet } from "./news";
import { readNews } from "../../_lib/stonkletNews";
vi.mock("../../_lib/stonkletNews", () => ({ readNews: vi.fn() }));
const get = (query: string) => onRequestGet({ request: new Request(`https://example.com/api/stonklets/news${query}`), env: { WARPLETS: {} } } as never);
beforeEach(() => { vi.clearAllMocks(); vi.mocked(readNews).mockResolvedValue({ entries: [], status: "unavailable", lastEvaluatedAt: null }); });
describe("news API bounds", () => {
  it("rejects unknown identities, overlarge batches and conflicting selectors", async () => {
    for (const query of ["?pairs=unknown", "?pairs=", `?pairs=${Array(21).fill("apple").join(",")}`, "?news=invalid", `?news=news-${"a".repeat(24)}&pairs=apple`]) expect((await get(query)).status).toBe(400);
    expect(readNews).not.toHaveBeenCalled();
  });
  it("deduplicates a bounded stock request and bypasses cache for withdrawal checks", async () => {
    const response = await get("?pairs=apple,apple,amazon");
    expect(response.status).toBe(200);
    expect(readNews).toHaveBeenLastCalledWith({}, { pairs: ["apple", "amazon"] });
    expect(response.headers.get("cache-control")).toContain("max-age=30");
    expect((await get(`?news=news-${"a".repeat(24)}&validate=1`)).headers.get("cache-control")).toContain("no-store");
  });
  it("returns a retryable failure rather than a successful empty feed on outages", async () => {
    vi.mocked(readNews).mockRejectedValue(new Error("D1 unavailable"));
    expect((await get("")).status).toBe(503);
  });
});
