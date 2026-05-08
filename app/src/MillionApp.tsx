import { useEffect, useState } from "react";
import sdk from "@farcaster/miniapp-sdk";
import { Text } from "@neynar/ui/typography";
import {
  MiniAppHeader,
  MiniAppMenuPage,
  getHeaderTitle,
  useMiniAppChrome,
} from "./miniAppChrome.tsx";
import MiniAppShell from "./MiniAppShell";

export default function MillionApp() {
  const [showOpenInFarcaster, setShowOpenInFarcaster] = useState(false);
  const { isMenuRoute, canGoBack, actions } = useMiniAppChrome("million");

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
        console.error("Million app init error:", err);
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
    <MiniAppShell>
      <div className="relative z-10 w-full">
        <MiniAppHeader
          appSlug="million"
          title={getHeaderTitle("million", isMenuRoute)}
          canGoBack={canGoBack}
          onBack={actions.goBack}
          onLogo={actions.openHubRoot}
          onMenu={actions.openMenu}
        />

        {isMenuRoute ? (
          <MiniAppMenuPage appSlug="million" />
        ) : (
          <div className="mx-auto mt-10 w-auto max-w-md rounded-2xl border border-yellow-300/40 bg-[#121004]/90 p-6 text-center mx-6">
        <Text className="text-3xl font-bold text-yellow-300">$1M Warplet</Text>
        <Text className="mt-4 text-sm text-yellow-100/90">
          Coming soon. A dedicated experience for the $1M Warplet campaign.
        </Text>
        {showOpenInFarcaster && (
          <Text className="mt-5 text-xs text-yellow-100/70">
            Open this mini app inside Farcaster to preview the full experience.
          </Text>
        )}
          </div>
        )}
      </div>
    </MiniAppShell>
  );
}
