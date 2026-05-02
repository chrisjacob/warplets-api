import { useEffect, useState } from "react";
import sdk from "@farcaster/miniapp-sdk";
import { Text } from "@neynar/ui/typography";

export default function App() {
  const [fid, setFid] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    const init = async () => {
      try {
        const context = await sdk.context;
        setFid(context.user.fid);

        // If launched from a notification, record the open for analytics
        const loc = context.location as { type?: string; notification?: { notificationId?: string } } | undefined;
        if (loc?.type === "notification" && loc.notification?.notificationId) {
          fetch("/api/notifications/open", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              notificationId: loc.notification.notificationId,
              fid: context.user.fid,
            }),
          }).catch(() => {}); // fire-and-forget; never block UX
        }
      } catch (err) {
        console.error("Failed to get user context:", err);
      }
      // Hide the splash screen once the app is ready
      sdk.actions.ready();
    };
    init();
  }, []);

  const handleEnableNotifications = async () => {
    try {
      setIsAdding(true);
      setStatus("Prompting add flow in host...");

      await sdk.actions.addMiniApp();
      setStatus("If you added the app, webhook events should now be sent by the host.");
    } catch (err) {
      console.error("Error adding mini app:", err);
      setStatus("Error: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center space-y-4">
        <Text className="text-2xl font-bold">10X</Text>
        {fid && <Text className="text-sm text-gray-400">FID: {fid}</Text>}
        <button
          onClick={handleEnableNotifications}
          disabled={isAdding || !fid}
          className="px-6 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded-lg font-medium transition"
        >
          {isAdding ? "Loading..." : "Enable Notifications"}
        </button>
        <Text className="text-xs text-gray-500">
          Notification tokens are delivered via webhook events from the host.
        </Text>
        {status && <Text className="text-sm text-purple-400">{status}</Text>}
      </div>
    </div>
  );
}
