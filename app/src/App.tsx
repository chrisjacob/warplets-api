import { useEffect, useState } from "react";
import sdk from "@farcaster/miniapp-sdk";
import { Text } from "@neynar/ui/typography";

type WarpletStatus = {
  fid: number;
  exists: boolean;
  matched: boolean;
  rarityValue: number | null;
};

export default function App() {
  const [fid, setFid] = useState<number | null>(null);
  const [status, setStatus] = useState<WarpletStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

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

        const res = await fetch("/api/warplet-status", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fid: context.user.fid }),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Failed to load status (${res.status}): ${text}`);
        }

        const data = (await res.json()) as WarpletStatus;
        setStatus(data);
      } catch (err) {
        console.error("Failed to get user context:", err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
      // Hide the splash screen once the app is ready
      sdk.actions.ready();
    };
    init();
  }, []);

  const isMatched = Boolean(status?.matched && typeof status.rarityValue === "number");
  const imageUrl = isMatched
    ? `https://warplets.10x.meme/${status?.rarityValue}.avif`
    : "https://warplets.10x.meme/3081.png";
  const title = isMatched
    ? "🎉 Congratulations! You're on the list..."
    : "😭 Oh Snap... You're not on the list.";
  const buttonLabel = isMatched
    ? "👉 Buy in Farcaster Wallet"
    : "👉 Visit OpenSea to find out why...";

  const handlePrimaryAction = async () => {
    if (isMatched) {
      // Placeholder until wallet purchase flow is implemented.
      return;
    }

    await sdk.actions.openUrl("https://opensea.io/collection/10xwarplets/overview");
  };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md text-center space-y-4">
        <Text className="text-2xl font-bold">10X Warplets</Text>
        {fid && <Text className="text-sm text-gray-400">FID: {fid}</Text>}

        {loading && <Text className="text-sm text-gray-300">Loading your Warplet status...</Text>}

        {!loading && error && (
          <Text className="text-sm text-red-400">{error}</Text>
        )}

        {!loading && !error && (
          <>
            <Text className="text-lg font-semibold">{title}</Text>
            <img
              src={imageUrl}
              alt="Warplet preview"
              className="w-full rounded-xl border border-white/15"
              loading="eager"
            />
            <button
              onClick={handlePrimaryAction}
              className="w-full px-5 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 text-white rounded-lg font-medium transition"
            >
              {buttonLabel}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
