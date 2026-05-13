import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import DropApp from "./DropApp.tsx";
import FindApp from "./FindApp.tsx";
import MillionApp from "./MillionApp.tsx";
import StopApp from "./StopApp.tsx";
import UnsubscribeApp from "./UnsubscribeApp.tsx";

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

  if (hostname === "drop.10x.meme" || hostname === "drop-local.10x.meme" || hostname === "drop-dev.10x.meme") return <DropApp />;
  if (hostname === "find.10x.meme" || hostname === "find-local.10x.meme" || hostname === "find-dev.10x.meme") return <FindApp />;
  if (hostname === "million.10x.meme" || hostname === "million-local.10x.meme" || hostname === "million-dev.10x.meme") return <MillionApp />;

  if (cleanPath === "/drop" || cleanPath.startsWith("/drop/")) return <DropApp />;
  if (cleanPath === "/find" || cleanPath.startsWith("/find/")) return <FindApp />;
  if (cleanPath === "/million" || cleanPath.startsWith("/million/")) return <MillionApp />;
  if (cleanPath === "/stop" || cleanPath.startsWith("/stop/")) return <StopApp />;
  if (cleanPath === "/unsubscribe" || cleanPath.startsWith("/unsubscribe/")) return <UnsubscribeApp />;

  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {resolveActiveApp()}
  </StrictMode>
);
