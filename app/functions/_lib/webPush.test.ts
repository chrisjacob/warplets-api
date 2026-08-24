import { describe, expect, it } from "vitest";
import { classifyWebPushResponse } from "./webPush";

describe("Web Push response classification", () => {
  it.each([200, 201, 202, 204, 299])("treats HTTP %s as delivered", (status) => {
    expect(classifyWebPushResponse(status)).toBe("delivered");
  });

  it.each([404, 410])("disables permanently invalid HTTP %s subscriptions", (status) => {
    expect(classifyWebPushResponse(status)).toBe("invalid");
  });

  it("keeps rate limiting distinct from permanent failures", () => {
    expect(classifyWebPushResponse(429)).toBe("rate_limited");
    expect(classifyWebPushResponse(500)).toBe("failed");
  });
});
