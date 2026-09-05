import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeToWebPush } from "./pwa";
import { requestFarcasterNotifications } from "./surfaceAdapter";
import { enableStonkletsNotifications, stonkletsNotificationMode } from "./stonkletsNotifications";

vi.mock("./pwa", () => ({ subscribeToWebPush: vi.fn() }));
vi.mock("./surfaceAdapter", () => ({ requestFarcasterNotifications: vi.fn() }));
afterEach(() => vi.resetAllMocks());

describe("Stonklets notification routing", () => {
  it("uses the mini app host even when Web Push is unavailable", async () => {
    vi.mocked(requestFarcasterNotifications).mockResolvedValue({ notificationDetails: { url: "https://example.com/notifications", token: "test" } });
    await expect(enableStonkletsNotifications(stonkletsNotificationMode(true, false))).resolves.toContain("Farcaster");
    expect(requestFarcasterNotifications).toHaveBeenCalledOnce();
    expect(subscribeToWebPush).not.toHaveBeenCalled();
  });
  it("explains manual settings when an installed app has notifications disabled", async () => {
    vi.mocked(requestFarcasterNotifications).mockResolvedValue({});
    await expect(enableStonkletsNotifications("farcaster")).rejects.toThrow("Stonklets’ settings");
    expect(subscribeToWebPush).not.toHaveBeenCalled();
  });
  it("does not request Web Push or falsely claim a subscription for Base Save instructions", async () => {
    await expect(enableStonkletsNotifications(stonkletsNotificationMode(false, true))).resolves.toBeNull();
    expect(subscribeToWebPush).not.toHaveBeenCalled();
    expect(requestFarcasterNotifications).not.toHaveBeenCalled();
  });
  it("subscribes browser users to launch notifications", async () => {
    await enableStonkletsNotifications(stonkletsNotificationMode(false, false));
    expect(subscribeToWebPush).toHaveBeenCalledWith(["launches"]);
    expect(requestFarcasterNotifications).not.toHaveBeenCalled();
  });
});
