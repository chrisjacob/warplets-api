import { useEffect, useState } from "react";
import sdk from "@farcaster/miniapp-sdk";
import confetti from "canvas-confetti";
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
  const [didCelebrate, setDidCelebrate] = useState(false);

  const launchTopConfetti = () => {
    const colors = ["#ff4d4d", "#ffd93d", "#57e389", "#4da3ff", "#b07bff", "#ff7ac8"];
    const bursts = [0.12, 0.3, 0.5, 0.7, 0.88];

    for (const [index, x] of bursts.entries()) {
      setTimeout(() => {
        confetti({
          particleCount: 65,
          spread: 68,
          startVelocity: 36,
          gravity: 0.92,
          ticks: 300,
          scalar: 1.05,
          origin: { x, y: 0 },
          colors,
        });
      }, index * 160);
    }
  };

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

  const forceNoMatch =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("match") === "false";
  const isMatched = !forceNoMatch && Boolean(status?.matched && typeof status.rarityValue === "number");

  useEffect(() => {
    if (loading || error || !isMatched || didCelebrate) return;

    launchTopConfetti();
    setDidCelebrate(true);
  }, [loading, error, isMatched, didCelebrate]);

  const imageUrl = isMatched
    ? `https://warplets.10x.meme/${status?.rarityValue}.avif`
    : "https://warplets.10x.meme/3081.png";
  const title = isMatched
    ? "Congratulations! You're on the list..."
    : "Oh Snap... You're not on the list.";
  const badgeLabel = isMatched
    ? "🔓 Private 10K NFT Drop"
    : "🔒 Private 10K NFT Drop";
  const buttonLabel = isMatched
    ? "Buy in Farcaster Wallet"
    : "Visit OpenSea to find out why...";

  const handlePrimaryAction = async () => {
    if (isMatched) {
      launchTopConfetti();
      // Placeholder until wallet purchase flow is implemented.
      return;
    }

    await sdk.actions.openUrl("https://opensea.io/collection/10xwarplets/overview");
  };

  const handleOpenSeaAction = async () => {
    await sdk.actions.openUrl("https://opensea.io/collection/10xwarplets/overview");
  };

  const handleSplashAction = async () => {
    await sdk.actions.openUrl("https://10x.meme");
  };

  return (
    <div
      className="relative min-h-screen bg-black text-white flex flex-col items-center pb-8 overflow-hidden"
      style={{ fontFamily: '"Roboto Mono", system-ui, sans-serif' }}
    >
      {/* Animated background */}
      <img
        src="/bg2.gif"
        alt=""
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover opacity-25 pointer-events-none select-none"
      />

      <div className="relative z-10 w-full h-[80px] bg-black flex items-start justify-between">
        <button
          type="button"
          aria-label="Open 10X website"
          onClick={handleSplashAction}
          className="h-full cursor-pointer"
        >
          <img
            src="/splash.png"
            alt="10X Warplets"
            className="h-full w-auto object-contain pl-[15px]"
            loading="eager"
          />
        </button>
        <button
          type="button"
          aria-label="Open 10X Warplets on OpenSea"
          onClick={handleOpenSeaAction}
          className="pl-5 pr-4 py-5 flex items-start cursor-pointer"
        >
          <img
            src="/opensea.png"
            alt="OpenSea"
            className="w-[40px] h-[40px]"
            loading="eager"
          />
        </button>
      </div>

      <div className="relative z-10 w-full max-w-md text-center space-y-2 px-4 pt-2">
        <div className="relative px-4 pt-2 pb-4 text-center">
          <Text className="text-5xl font-bold leading-tight" style={{ color: "#00FF00" }}>10X Warplets</Text>
          <Text
            className="inline-flex mt-3 px-3 py-1 text-sm font-semibold leading-tight border border-[#00FF00]/70 rounded-full"
            style={{ color: "#00FF00", backgroundColor: "rgba(0, 255, 0, 0.12)" }}
          >
            {badgeLabel}
          </Text>
        </div>

        {loading && <Text className="text-sm" style={{ color: "#00FF00" }}>Loading your 10X Warplet status...</Text>}

        {!loading && error && (
          <Text className="text-sm text-red-400">{error}</Text>
        )}

        {!loading && !error && (
          <div className="space-y-0">
            <div className="px-4 pb-5 pt-0 space-y-3">
              <Text className="text-lg font-semibold" style={{ color: "#00FF00" }}>
                {title}
              </Text>
              <img
                src={imageUrl}
                alt="Loading..."
                className="w-full rounded-[20px] p-[2px] bg-[#00FF00]/20 border border-[#00FF00]/45"
                loading="eager"
              />
            </div>
            <div className="px-4">
              <button
                onClick={handlePrimaryAction}
                className="w-full mt-0 px-5 py-3 rounded-[20px] border border-[#009900] bg-[#00FF00] hover:bg-[#33ff33] font-bold text-lg transition-all duration-100 shadow-[3px_6px_0_#008000] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] disabled:bg-gray-700 disabled:border-gray-700 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 cursor-pointer"
                style={{ color: "rgb(0, 80, 0)" }}
              >
                {buttonLabel}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
