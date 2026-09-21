import { Component, StrictMode, Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { initializePwa, isEmbeddedWebView, isLikelyBaseAppBrowser } from "./pwa";
import { WARPLETS_APP_HOSTS, WARPLETS_APP_PATH } from "../shared/warpletsApp";
import { STONKLETS_APP_HOSTS, STONKLETS_APP_PATH } from "../shared/stonkletsApp";
import { captureWarpmojiAttribution } from "./analytics";
import { clearLocalCacheIfRequested } from "./localCacheReset";
import { claimPreloadRecovery } from "./preloadRecovery";
import { captureHolderOutreachAttribution } from "./outreachAttribution";

const HOME_APP_HOSTS = new Set([
  "10x.meme",
  "www.10x.meme",
  "app.10x.meme",
  "app-dev.10x.meme",
  "app-local.10x.meme",
]);

function configureHomePwaMetadata(): void {
  if (!HOME_APP_HOSTS.has(window.location.hostname.toLowerCase())) return;
  document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.setAttribute("href", "/manifest-10x.webmanifest");
  document.querySelector<HTMLMetaElement>('meta[name="application-name"]')?.setAttribute("content", "10X.MEME");
  document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", "10X.MEME");
}

clearLocalCacheIfRequested(window);
configureHomePwaMetadata();
initializePwa();
captureWarpmojiAttribution();
captureHolderOutreachAttribution();

const App = lazy(() => import("./App.tsx"));
const DropApp = lazy(() => import("./DropClosedApp.tsx"));
const SearchApp = lazy(() => import("./SearchApp.tsx"));
const StonkletsApp = lazy(() => import("./StonkletsApp.tsx"));
const StonkletShareRender = lazy(() => import("./StonkletShareRender.tsx"));
const MillionApp = lazy(() => import("./MillionApp.tsx"));
const StopApp = lazy(() => import("./StopApp.tsx"));
const UnsubscribeApp = lazy(() => import("./UnsubscribeApp.tsx"));
const StatsShareCardPage = lazy(() => import("./StatsShareCard.tsx"));
const StatsShareFixturePage = lazy(() => import("./StatsShareCard.tsx").then((module) => ({ default: module.StatsShareFixturePage })));
const DeveloperPage = lazy(() => import("./DeveloperPage.tsx"));
const BotLinkPage = lazy(() => import("./BotLinkPage.tsx"));
const TabsEntryPage = lazy(() => import("./TabsEntryPage.tsx"));
const LegalPage = lazy(() => import("./LegalPage.tsx"));

const PRELOAD_RECOVERY_KEY = "10x-vite-preload-recovery";
let appMounted = false;

function getRejectedImageSrc(value: unknown): string | null {
  if (typeof HTMLImageElement === "undefined") return null;
  const target = (value as { target?: unknown; srcElement?: unknown } | null)?.target
    ?? (value as { srcElement?: unknown } | null)?.srcElement;
  return target instanceof HTMLImageElement ? target.src : null;
}

function isExternalFarcasterImageProxy(src: string | null): boolean {
  if (!src) return false;
  try {
    const url = new URL(src);
    return (
      url.hostname === "wrpcd.net" ||
      url.hostname.endsWith(".cloudfront.net")
    );
  } catch {
    return false;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (event) => {
    let recover = false;
    try {
      recover = claimPreloadRecovery(window.sessionStorage, PRELOAD_RECOVERY_KEY, {
        appMounted,
        embedded: isEmbeddedWebView() || isLikelyBaseAppBrowser(),
      });
    } catch { /* Storage can be inaccessible in restricted browsers. */ }
    // Let failed imports reject normally when recovery is exhausted. Cancelling
    // Vite's event otherwise resolves the import as undefined and crashes React.lazy.
    if (!recover) return;
    event.preventDefault();
    window.location.reload();
  });
  window.addEventListener("unhandledrejection", (event) => {
    const src = getRejectedImageSrc(event.reason);
    if (!isExternalFarcasterImageProxy(src)) return;
    event.preventDefault();
    console.warn("[10X] Ignored failed third-party image proxy load", src);
  });
}

function resolveActiveApp() {
  const { hostname, pathname } = window.location;
  const cleanPath = pathname.replace(/\/+$/, "") || "/";
  const stonkletRenderId = new URLSearchParams(window.location.search).get("shareRender");
  if (cleanPath === "/stonklets" && stonkletRenderId) return <StonkletShareRender id={stonkletRenderId} />;

  if (cleanPath === "/privacy") return <LegalPage document="privacy" />;
  if (cleanPath === "/terms") return <LegalPage document="terms" />;

  const statsShareFixtureMatch = cleanPath.match(/^\/stats\/share\/fixtures\/([a-z-]+)$/);
  if (statsShareFixtureMatch && hostname === WARPLETS_APP_HOSTS[0]) {
    return <StatsShareFixturePage fixture={statsShareFixtureMatch[1]!} />;
  }

  const statsShareMatch = cleanPath.match(/^\/stats\/share\/([a-f0-9]{32})(\/render)?$/);
  if (statsShareMatch) {
    return <StatsShareCardPage shareId={statsShareMatch[1]!} renderOnly={Boolean(statsShareMatch[2])} />;
  }

  if (cleanPath === "/developer") return <DeveloperPage />;
  if (cleanPath === "/link-bot") return <BotLinkPage />;
  if (cleanPath === "/tabs") return <TabsEntryPage />;

  if (hostname === "drop.10x.meme" || hostname === "drop-local.10x.meme" || hostname === "drop-dev.10x.meme") return <DropApp />;
  if ((WARPLETS_APP_HOSTS as readonly string[]).includes(hostname)) return <SearchApp />;
  if ((STONKLETS_APP_HOSTS as readonly string[]).includes(hostname)) return <StonkletsApp />;
  if (hostname === "million.10x.meme" || hostname === "million-local.10x.meme" || hostname === "million-dev.10x.meme") return <MillionApp />;

  if (cleanPath === "/drop" || cleanPath.startsWith("/drop/")) return <DropApp />;
  if (cleanPath === WARPLETS_APP_PATH || cleanPath.startsWith(`${WARPLETS_APP_PATH}/`)) return <SearchApp />;
  if (cleanPath === STONKLETS_APP_PATH || cleanPath.startsWith(`${STONKLETS_APP_PATH}/`)) return <StonkletsApp />;
  if (cleanPath === "/million" || cleanPath.startsWith("/million/")) return <MillionApp />;
  if (cleanPath === "/stop" || cleanPath.startsWith("/stop/")) return <StopApp />;
  if (cleanPath === "/unsubscribe" || cleanPath.startsWith("/unsubscribe/")) return <UnsubscribeApp />;

  return <App />;
}

function RootRouter() {
  const [, setNavigationKey] = useState(0);

  useEffect(() => {
    appMounted = true;
    // A window load event can fire even when the lazy app failed to start.
    // Clear the reload guard only after the actual app has committed.
    try { window.sessionStorage.removeItem(PRELOAD_RECOVERY_KEY); } catch { /* best effort */ }
    const handlePopState = () => setNavigationKey((key) => key + 1);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  return resolveActiveApp();
}

class AppLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black p-6 text-center text-[#b8d7b8]">
      <p>The app couldn’t finish loading.</p>
      <button className="rounded-lg border border-[#00ff00] px-5 py-3 font-bold text-[#00ff00]" onClick={() => window.location.reload()}>Reload app</button>
    </div>;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppLoadBoundary>
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-black text-[#b8d7b8]" role="status">Loading 10X…</div>}>
      <RootRouter />
    </Suspense>
    </AppLoadBoundary>
  </StrictMode>
);
