import { describe, expect, it } from "vitest";
import { activityNotificationDisposition } from "./warpletNotifications";

describe("historical activity notification suppression", () => {
  it("marks suppressed bootstrap activity as handled", () => {
    expect(activityNotificationDisposition(false, null)).toBe("suppress");
  });

  it("does not revisit activity that was already handled", () => {
    expect(activityNotificationDisposition(true, "2026-08-25T00:00:00.000Z")).toBe("already_handled");
    expect(activityNotificationDisposition(false, "2026-08-25T00:00:00.000Z")).toBe("already_handled");
  });

  it("queues new live activity by default", () => {
    expect(activityNotificationDisposition(undefined, null)).toBe("queue");
  });
});
