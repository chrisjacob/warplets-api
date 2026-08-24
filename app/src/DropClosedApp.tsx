import { useEffect } from "react";
import sdk from "@farcaster/miniapp-sdk";
import MiniAppShell from "./MiniAppShell";
import { MiniAppHeader, MiniAppMenuPage, useMiniAppChrome } from "./miniAppChrome.tsx";
import SiteFooter from "./SiteFooter";
import { hapticPrimaryTap } from "./haptics";
import { WARPLETS_APP_ORIGINS } from "../shared/warpletsApp";

type DropStatusResponse = {
  actionSessionToken?: string | null;
};

function getSearchOrigin(): string {
  const hostname = window.location.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname.includes("-local.")) {
    return WARPLETS_APP_ORIGINS.local;
  }
  if (hostname.includes("-dev.")) return WARPLETS_APP_ORIGINS.dev;
  return WARPLETS_APP_ORIGINS.prod;
}

function getSearchUrl(path = "/"): string {
  return new URL(path, `${getSearchOrigin().replace(/\/$/, "")}/`).toString();
}

async function openSearchApp(path = "/"): Promise<void> {
  const url = getSearchUrl(path);
  const inMiniApp = typeof sdk.isInMiniApp === "function"
    ? await sdk.isInMiniApp().catch(() => false)
    : false;

  if (inMiniApp) {
    try {
      await sdk.actions.openMiniApp({ url });
      return;
    } catch {
      // Fall through to same-window navigation when app switching is unavailable.
    }
  }

  window.location.assign(url);
}

async function recordNotificationOpen(fid: number, notificationId: string): Promise<void> {
  const statusResponse = await fetch("/api/warplet-status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fid }),
  });
  if (!statusResponse.ok) return;

  const status = await statusResponse.json() as DropStatusResponse;
  const sessionToken = status.actionSessionToken?.trim();
  if (!sessionToken) return;

  await fetch("/api/notifications/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ notificationId, sessionToken, appSlug: "drop" }),
  });
}

export default function DropClosedApp() {
  const { isMenuRoute, canGoBack, actions } = useMiniAppChrome("drop");

  useEffect(() => {
    document.title = "10X Warplets Drop — Drop Complete";

    let cancelled = false;
    const initialize = async () => {
      let inMiniApp = false;
      try {
        inMiniApp = typeof sdk.isInMiniApp === "function" ? await sdk.isInMiniApp() : false;
        if (!inMiniApp || cancelled) return;

        const context = await sdk.context;
        const location = context.location as { type?: string; notification?: { notificationId?: string } } | undefined;
        const notificationId = location?.type === "notification" ? location.notification?.notificationId : null;
        const fid = Number(context.user?.fid);
        if (notificationId && Number.isInteger(fid) && fid > 0) {
          void recordNotificationOpen(fid, notificationId).catch(() => {
            // Notification analytics must never prevent the landing page loading.
          });
        }
      } catch (error) {
        console.warn("Drop completion page initialization failed:", error);
      } finally {
        if (inMiniApp && !cancelled) void sdk.actions.ready();
      }
    };

    void initialize();
    return () => { cancelled = true; };
  }, []);

  const openDestination = (path: string) => {
    void hapticPrimaryTap();
    void openSearchApp(path).catch((error) => {
      console.error("Failed to open 10X Warplets:", error);
      window.location.assign(getSearchUrl(path));
    });
  };

  return (
    <MiniAppShell>
      <div className="relative z-30 w-full">
        <MiniAppHeader
          appSlug="drop"
          title={isMenuRoute ? "Menu" : "Drop Complete"}
          canGoBack={canGoBack}
          onBack={actions.goBack}
          onLogo={actions.openHubRoot}
          onMenu={actions.openMenu}
        />

        {isMenuRoute ? (
          <MiniAppMenuPage appSlug="drop" />
        ) : (
          <main className="mx-auto w-full max-w-md px-4 pb-10 pt-6">
            <section className="overflow-hidden rounded-2xl border border-[#00FF00]/35 bg-black/80 shadow-[0_0_20px_rgba(0,255,0,0.13)]">
              <video
                src="https://warplets.10x.meme/1391.mp4"
                className="aspect-square w-full object-cover"
                autoPlay
                loop
                muted
                playsInline
                aria-label="Animated 10X Warplet #1391"
              />

              <div className="px-5 pb-6 pt-5 text-center">
                <h1 className="text-2xl font-black leading-tight text-[#00FF00] drop-shadow-[0_0_7px_rgba(0,255,0,0.4)]">
                  The Drop Has Finished
                </h1>
                <p className="mt-4 text-sm font-semibold leading-6 text-[#d9f5d9]">
                  Airdropped to 10,000 <strong>diamond hands</strong>.
                </p>
                <p className="mt-3 text-sm leading-6 text-[#b8d7b8]">
                  A solid foundation for The 10X Network.
                </p>

                <button
                  type="button"
                  className="mt-5 w-full rounded-[14px] border border-[#009900] bg-[#00FF00] px-5 py-3 text-base font-black text-[rgb(0,80,0)] shadow-[2px_4px_0_#008000] transition hover:bg-[#33ff33] active:translate-x-[1px] active:translate-y-[2px] active:shadow-[1px_2px_0_#008000]"
                  onClick={() => openDestination("/")}
                >
                  Explore 10X Warplets
                </button>
              </div>
            </section>
          </main>
        )}

        <SiteFooter />
      </div>
    </MiniAppShell>
  );
}
