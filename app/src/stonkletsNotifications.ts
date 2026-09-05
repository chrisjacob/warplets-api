import { subscribeToWebPush } from "./pwa";
import { requestFarcasterNotifications } from "./surfaceAdapter";

export type StonkletsNotificationMode = "farcaster" | "base" | "web";

export function stonkletsNotificationMode(inMiniApp: boolean, inBaseBrowser: boolean): StonkletsNotificationMode {
  return inMiniApp ? "farcaster" : inBaseBrowser ? "base" : "web";
}

export async function enableStonkletsNotifications(mode: StonkletsNotificationMode): Promise<string | null> {
  // Base's Save action belongs to the host menu, as in Warplets. Acknowledging
  // the instructions is not proof of a notification subscription.
  if (mode === "base") return null;
  if (mode === "farcaster") {
    const result = await requestFarcasterNotifications();
    if (!result.notificationDetails) throw new Error("Open Stonklets’ settings in Farcaster and enable notifications manually.");
    return "Farcaster notifications are enabled for Stonklets.";
  }
  await subscribeToWebPush(["launches"]);
  return "Browser launch notifications are enabled for Stonklets.";
}
