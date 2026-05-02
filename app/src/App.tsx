import { useEffect, useState } from "react";
import sdk from "@farcaster/miniapp-sdk";
import { Text } from "@neynar/ui/typography";

export default function App() {
  const [fid, setFid] = useState<number | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    const init = async () => {
      try {
        const context = await sdk.context;
        setFid(context.user.fid);
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
      setIsRegistering(true);
      setStatus("Requesting permission...");

      const result = await sdk.actions.requestNotificationPermission();

      if (!result.success) {
        setStatus("Permission denied");
        return;
      }

      if (!fid) {
        setStatus("Could not get user FID");
        return;
      }

      setStatus("Registering with Neynar...");

      const registerResp = await fetch("/register-notification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fid,
          notificationToken: result.notificationToken,
        }),
      });

      if (!registerResp.ok) {
        const error = await registerResp.json();
        setStatus(`Registration failed: ${error.error}`);
        return;
      }

      setStatus("✓ Notifications enabled!");
      setTimeout(() => setStatus(""), 3000);
    } catch (err) {
      console.error("Error enabling notifications:", err);
      setStatus("Error: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center space-y-4">
        <Text className="text-2xl font-bold">10X</Text>
        {fid && <Text className="text-sm text-gray-400">FID: {fid}</Text>}
        <button
          onClick={handleEnableNotifications}
          disabled={isRegistering || !fid}
          className="px-6 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded-lg font-medium transition"
        >
          {isRegistering ? "Loading..." : "Enable Notifications"}
        </button>
        {status && <Text className="text-sm text-purple-400">{status}</Text>}
      </div>
    </div>
  );
}
