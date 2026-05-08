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

const APPS = [
  {
    title: "10X Warplets Drop",
    path: "/drop",
    description: "Live now. Buy, claim, and share your Warplet.",
    accent: "#00FF00",
  },
  {
    title: "10X Warplets Find",
    path: "/find",
    description: "Coming soon. Discover Warplets and rarity faster.",
    accent: "#67e8f9",
  },
  {
    title: "$1M Warplet",
    path: "/million",
    description: "Coming soon. Dedicated mission for the $1M run.",
    accent: "#fde047",
  },
];

function launch(path: string) {
  const url = `${window.location.origin}${path}`;
  window.location.href = url;
}

export default function App() {
  const [showAddAppPrompt, setShowAddAppPrompt] = useState(false);
  const [notificationsOnlyPrompt, setNotificationsOnlyPrompt] = useState(false);
  const [showOpenInFarcaster, setShowOpenInFarcaster] = useState(false);
  const [actionError, setActionError] = useState("");
  const { isMenuRoute, canGoBack, actions } = useMiniAppChrome("app");

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
        const context = await sdk.context;

        const isProdHost =
          typeof window !== "undefined" &&
          window.location.host === "app.10x.meme" &&
          (window.location.pathname === "/" || window.location.pathname === "");
        const addParamSet =
          typeof window !== "undefined" &&
          new URLSearchParams(window.location.search).get("add") === "1";
        const shouldPromptAddApp =
          (isProdHost || addParamSet) &&
          (!context.client.added || !context.client.notificationDetails);
        const isNotificationsOnly =
          shouldPromptAddApp && context.client.added && !context.client.notificationDetails;
        setShowAddAppPrompt(shouldPromptAddApp);
        setNotificationsOnlyPrompt(isNotificationsOnly);
      } catch (err) {
        console.error("Hub init error:", err);
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

  useEffect(() => {
    if (!actionError) return;
    const id = window.setTimeout(() => setActionError(""), 5000);
    return () => window.clearTimeout(id);
  }, [actionError]);

  const handleConfirmAddAppPrompt = async () => {
    setShowAddAppPrompt(false);
    try {
      await sdk.actions.addMiniApp();
    } catch (err) {
      console.error("Failed to add mini app:", err);
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <MiniAppShell>
      <div className="relative z-10 w-full">
        <MiniAppHeader
          appSlug="app"
          title={getHeaderTitle("app", isMenuRoute)}
          canGoBack={canGoBack}
          onBack={actions.goBack}
          onLogo={actions.goToCurrentRoot}
          onMenu={actions.openMenu}
        />

        {isMenuRoute ? (
          <MiniAppMenuPage appSlug="app" />
        ) : (
          <div className="mx-auto w-full max-w-md px-4 pt-8">
        <Text className="text-[2.4rem] font-bold text-center" style={{ color: "#00FF00" }}>
          10X
        </Text>
        <Text className="mt-2 text-center text-sm" style={{ color: "#b7ffb7" }}>
          Launchpad for all 10X mini apps.
        </Text>

        <div className="mt-6 space-y-3">
          {APPS.map(app => (
            <button
              key={app.path}
              type="button"
              onClick={() => launch(app.path)}
              className="w-full rounded-2xl border bg-black/40 px-4 py-4 text-left transition-colors hover:bg-black/60 cursor-pointer"
              style={{ borderColor: `${app.accent}80` }}
            >
              <Text className="text-lg font-bold" style={{ color: app.accent }}>
                {app.title}
              </Text>
              <Text className="mt-1 text-xs" style={{ color: "#d9d9d9" }}>
                {app.description}
              </Text>
              <Text className="mt-2 text-[11px] uppercase tracking-wide" style={{ color: "#9ca3af" }}>
                {app.path}
              </Text>
            </button>
          ))}
        </div>

        {showOpenInFarcaster && (
          <div className="mt-8 rounded-2xl border border-[#00FF0040] bg-black/60 px-4 py-5 text-center">
            <Text className="text-sm font-bold" style={{ color: "#00FF00" }}>
              Open in Farcaster
            </Text>
            <Text className="mt-2 text-xs" style={{ color: "#b7ffb7" }}>
              10X mini apps are designed for Farcaster. Open this link inside the Farcaster app to get started.
            </Text>
          </div>
        )}

        {actionError && (
          <div className="mt-4 rounded-xl border border-red-500/40 bg-red-900/20 px-3 py-2">
            <Text className="text-xs text-red-400">{actionError}</Text>
          </div>
        )}
          </div>
        )}
      </div>

      {showAddAppPrompt && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 pb-8">
          <div
            className="w-full max-w-sm rounded-2xl border bg-black px-5 py-6 shadow-2xl"
            style={{ borderColor: "#00FF0060" }}
          >
            <Text className="text-lg font-bold text-center" style={{ color: "#00FF00" }}>
              {notificationsOnlyPrompt ? "Enable Notifications" : "Don't Miss Out"}
            </Text>
            <Text className="mt-3 text-sm text-center" style={{ color: "#d9d9d9" }}>
              {notificationsOnlyPrompt
                ? "Turn on notifications to get alerts for drops, price updates, and more."
                : "Add 10X to your Farcaster home screen and get notified about drops and price moves."}
            </Text>
            <button
              type="button"
              onClick={handleConfirmAddAppPrompt}
              className="mt-5 w-full rounded-xl py-3 font-bold text-black cursor-pointer"
              style={{ background: "#00FF00" }}
            >
              {notificationsOnlyPrompt ? "Enable Notifications" : "Add 10X"}
            </button>
            <button
              type="button"
              onClick={() => setShowAddAppPrompt(false)}
              className="mt-3 w-full rounded-xl py-2 text-sm cursor-pointer"
              style={{ color: "#9ca3af" }}
            >
              Maybe later
            </button>
          </div>
        </div>
      )}
    </MiniAppShell>
  );
}
