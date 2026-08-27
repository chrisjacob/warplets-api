import { describe, expect, it } from "vitest";
import { receiptConfirmsWarpletTransfer } from "./openseaTrade";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const COLLECTION = "0x780446dd12e080ae0db762fcd4daf313f3e359de";
const RECIPIENT = "0x436cd187fbe2102e3e2f842574301e951489c281";

function topicAddress(address: string): string {
  return `0x${address.slice(2).padStart(64, "0")}`;
}

function receipt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: "0x1",
    logs: [{
      address: COLLECTION,
      topics: [
        TRANSFER_TOPIC,
        topicAddress("0x4709a4b12daf0eedae0ef48a28a056640dee0846"),
        topicAddress(RECIPIENT),
        `0x${BigInt(9339).toString(16).padStart(64, "0")}`,
      ],
    }],
    ...overrides,
  };
}

describe("confirmed Warplet transfer receipts", () => {
  it("accepts a successful collection transfer of the expected token to the buyer", () => {
    expect(receiptConfirmsWarpletTransfer(receipt(), 9339, RECIPIENT)).toBe(true);
  });

  it("rejects reverted receipts and transfers to a different recipient", () => {
    expect(receiptConfirmsWarpletTransfer(receipt({ status: "0x0" }), 9339, RECIPIENT)).toBe(false);
    expect(receiptConfirmsWarpletTransfer(receipt(), 9339, "0x0000000000000000000000000000000000000001")).toBe(false);
  });

  it("rejects the wrong token or collection", () => {
    expect(receiptConfirmsWarpletTransfer(receipt(), 9234, RECIPIENT)).toBe(false);
    const wrongCollection = receipt({
      logs: [{
        address: "0x0000000000000000000000000000000000000001",
        topics: (receipt().logs as Array<{ topics: string[] }>)[0].topics,
      }],
    });
    expect(receiptConfirmsWarpletTransfer(wrongCollection, 9339, RECIPIENT)).toBe(false);
  });
});
