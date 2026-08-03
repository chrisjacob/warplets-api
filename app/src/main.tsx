import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { NeynarContextProvider, Theme } from "@neynar/react";
import "@neynar/react/dist/style.css";
import "./index.css";

const App = lazy(() => import("./App.tsx"));
const DropApp = lazy(() => import("./DropApp.tsx"));
const SearchApp = lazy(() => import("./SearchApp.tsx"));
const MillionApp = lazy(() => import("./MillionApp.tsx"));
const StopApp = lazy(() => import("./StopApp.tsx"));
const UnsubscribeApp = lazy(() => import("./UnsubscribeApp.tsx"));
const StatsShareCardPage = lazy(() => import("./StatsShareCard.tsx"));
const StatsShareFixturePage = lazy(() => import("./StatsShareCard.tsx").then((module) => ({ default: module.StatsShareFixturePage })));

const PRELOAD_RECOVERY_KEY = "10x-vite-preload-recovery";

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
    event.preventDefault();
    if (window.sessionStorage.getItem(PRELOAD_RECOVERY_KEY) === "1") return;
    window.sessionStorage.setItem(PRELOAD_RECOVERY_KEY, "1");
    window.location.reload();
  });
  window.addEventListener("load", () => {
    window.sessionStorage.removeItem(PRELOAD_RECOVERY_KEY);
  }, { once: true });
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

  const statsShareFixtureMatch = cleanPath.match(/^\/stats\/share\/fixtures\/([a-z-]+)$/);
  if (statsShareFixtureMatch && hostname === "search-local.10x.meme") {
    return <StatsShareFixturePage fixture={statsShareFixtureMatch[1]!} />;
  }

  const statsShareMatch = cleanPath.match(/^\/stats\/share\/([a-f0-9]{32})(\/render)?$/);
  if (statsShareMatch) {
    return <StatsShareCardPage shareId={statsShareMatch[1]!} renderOnly={Boolean(statsShareMatch[2])} />;
  }

  if (hostname === "drop.10x.meme" || hostname === "drop-local.10x.meme" || hostname === "drop-dev.10x.meme") return <DropApp />;
  if (hostname === "search.10x.meme" || hostname === "search-local.10x.meme" || hostname === "search-dev.10x.meme") return <SearchApp />;
  if (hostname === "million.10x.meme" || hostname === "million-local.10x.meme" || hostname === "million-dev.10x.meme") return <MillionApp />;

  if (cleanPath === "/drop" || cleanPath.startsWith("/drop/")) return <DropApp />;
  if (cleanPath === "/search" || cleanPath.startsWith("/search/")) return <SearchApp />;
  if (cleanPath === "/million" || cleanPath.startsWith("/million/")) return <MillionApp />;
  if (cleanPath === "/stop" || cleanPath.startsWith("/stop/")) return <StopApp />;
  if (cleanPath === "/unsubscribe" || cleanPath.startsWith("/unsubscribe/")) return <UnsubscribeApp />;

  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NeynarContextProvider
      settings={{
        clientId: import.meta.env.VITE_NEYNAR_CLIENT_ID ?? "",
        defaultTheme: Theme.Dark,
      }}
    >
      <Suspense fallback={<div className="min-h-screen bg-black" aria-label="Loading 10X" />}>
        {resolveActiveApp()}
      </Suspense>
    </NeynarContextProvider>
  </StrictMode>
);
