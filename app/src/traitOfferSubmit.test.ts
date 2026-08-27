import { describe, expect, it, vi } from "vitest";
import { submitTraitOfferWithRetry } from "./traitOfferSubmit.js";

describe("submitTraitOfferWithRetry", () => {
  it("retries a transient gateway response with the same signed payload", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("gateway timeout", { status: 502 }))
      .mockResolvedValueOnce(Response.json({ status: "submitted" }));
    const onRetry = vi.fn();
    const requestBody = JSON.stringify({ payload: { signature: "0xsigned" } });

    const result = await submitTraitOfferWithRetry(requestBody, {
      fetchImpl,
      baseDelayMs: 0,
      onRetry,
    });

    expect(result.response.status).toBe(200);
    expect(result.attempts).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[1]).toEqual(fetchImpl.mock.calls[1]?.[1]);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({
      attempt: 1,
      nextAttempt: 2,
      status: 502,
    }));
  });

  it("does not retry a non-transient rejection", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("invalid signature", { status: 400 }));

    const result = await submitTraitOfferWithRetry("{}", { fetchImpl, baseDelayMs: 0 });

    expect(result.response.status).toBe(400);
    expect(result.attempts).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a network failure without requesting a new signature", async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(Response.json({ status: "submitted" }));

    await expect(submitTraitOfferWithRetry("signed-body", { fetchImpl, baseDelayMs: 0 }))
      .resolves.toMatchObject({ attempts: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a collection-offer 524 against the collection endpoint", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("gateway timeout", { status: 524 }))
      .mockResolvedValueOnce(Response.json({ status: "submitted", recoveredExistingOrder: true }));

    const result = await submitTraitOfferWithRetry("signed-body", {
      endpoint: "/api/collection-offers/submit",
      fetchImpl,
      baseDelayMs: 0,
    });

    expect(result.response.status).toBe(200);
    expect(result.attempts).toBe(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(1, "/api/collection-offers/submit", expect.any(Object));
    expect(fetchImpl.mock.calls[0]?.[1]).toEqual(fetchImpl.mock.calls[1]?.[1]);
  });
});
