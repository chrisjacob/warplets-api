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

export default function SearchApp() {
  const [showOpenInFarcaster, setShowOpenInFarcaster] = useState(false);
  const { isMenuRoute, canGoBack, actions } = useMiniAppChrome("search");

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
        console.error("Search app init error:", err);
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
          appSlug="search"
          title={getHeaderTitle("search", isMenuRoute)}
          canGoBack={canGoBack}
          onBack={actions.goBack}
          onLogo={actions.openHubRoot}
          onMenu={actions.openMenu}
        />

        {isMenuRoute ? (
          <MiniAppMenuPage appSlug="search" />
        ) : (
          <div className="mx-auto mt-10 w-auto max-w-md rounded-2xl border border-[#00FF00]/40 bg-[#041204]/90 p-6 text-center mx-6">
          <Text className="text-3xl font-bold" style={{ color: "#00FF00" }}>
          10X Warplets Search
        </Text>
        <Text className="mt-4 text-sm" style={{ color: "#b7ffb7" }}>
          Coming soon. This app will help you search rare Warplets faster.
        </Text>
        {showOpenInFarcaster && (
          <Text className="mt-5 text-xs" style={{ color: "#7ddf7d" }}>
            Open this mini app inside Farcaster to preview the full experience.
          </Text>
        )}
          </div>
        )}
      </div>
    </MiniAppShell>
  );
}
