import { useEffect, useState } from "react";
import sdk from "@farcaster/miniapp-sdk";
import { Text } from "@neynar/ui/typography";

export default function FindApp() {
  const [showOpenInFarcaster, setShowOpenInFarcaster] = useState(false);

  useEffect(() => {
    let shouldCallReady = false;

    const init = async () => {
      try {
        const inMiniApp =
          typeof sdk.isInMiniApp === "function" ? await sdk.isInMiniApp() : true;

        if (!inMiniApp) {
          setShowOpenInFarcaster(true);
          return;
        }

        shouldCallReady = true;
        await sdk.context;
      } catch (err) {
        console.error("Find app init error:", err);
        const message = err instanceof Error ? err.message : String(err);
        const normalized = message.toLowerCase();
        const looksLikeBrowserLaunch =
          normalized.includes("context is undefined") ||
          normalized.includes("can't access property \"user\"") ||
          normalized.includes("cannot read properties of undefined");

        if (looksLikeBrowserLaunch) {
          setShowOpenInFarcaster(true);
        }
      } finally {
        if (shouldCallReady) {
          sdk.actions.ready();
        }
      }
    };

    init();
  }, []);

  return (
    <div
      className="relative min-h-screen bg-black text-white flex flex-col items-center justify-center px-6"
      style={{ fontFamily: '"Roboto Mono", system-ui, sans-serif' }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(0,255,0,0.16),_rgba(0,0,0,0.92)_60%)]" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-[#00FF00]/40 bg-[#041204]/90 p-6 text-center">
        <Text className="text-3xl font-bold" style={{ color: "#00FF00" }}>
          10X Warplets Find
        </Text>
        <Text className="mt-4 text-sm" style={{ color: "#b7ffb7" }}>
          Coming soon. This app will help you discover rare Warplets faster.
        </Text>
        {showOpenInFarcaster && (
          <Text className="mt-5 text-xs" style={{ color: "#7ddf7d" }}>
            Open this mini app inside Farcaster to preview the full experience.
          </Text>
        )}
      </div>
    </div>
  );
}
