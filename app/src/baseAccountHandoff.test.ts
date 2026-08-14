import { describe, expect, it, vi } from "vitest";
import { dismissBaseAccountPopup } from "./baseAccountHandoff";
import type { EthereumProvider } from "./walletTrade";

describe("Base Account popup handoff", () => {
  it("closes the SDK communicator without disconnecting the provider", () => {
    const communicatorDisconnect = vi.fn();
    const providerDisconnect = vi.fn();
    const provider = {
      request: vi.fn(),
      disconnect: providerDisconnect,
      communicator: { disconnect: communicatorDisconnect },
    } as unknown as EthereumProvider;

    expect(dismissBaseAccountPopup(provider)).toBe(true);
    expect(communicatorDisconnect).toHaveBeenCalledOnce();
    expect(providerDisconnect).not.toHaveBeenCalled();
  });

  it("is a no-op for providers without the Base Account communicator", () => {
    const provider = { request: vi.fn() } as unknown as EthereumProvider;
    expect(dismissBaseAccountPopup(provider)).toBe(false);
  });
});
