import type { AppSurface } from "./appRuntime";
import type { EntryPoint } from "./pwa";
import { WARPLETS_APP_PATH, isWarpletsAppHostname } from "../shared/warpletsApp";

export type AnalyticsEventName =
  | "app_viewed"
  | "route_viewed"
  | "connect_opened"
  | "connector_selected"
  | "connect_succeeded"
  | "connect_rejected"
  | "connect_failed"
  | "farcaster_identity_connected"
  | "notification_status_viewed"
  | "notification_prompt_viewed"
  | "pwa_install_prompted"
  | "pwa_installed"
  | "web_push_subscribed"
  | "share_started"
  | "transaction_prepared"
  | "transaction_wallet_prompted"
  | "transaction_submitted"
  | "transaction_confirmed"
  | "transaction_failed";

export interface AnalyticsContext {
  surface?: AppSurface;
  entryPoint?: EntryPoint;
  connector?: string;
  route?: string;
  transactionType?: string;
  channel?: "farcaster" | "base" | "web-push" | "telegram" | "discord";
  result?: string;
}

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

const SESSION_KEY = "warplets_analytics_session";

function anonymousSessionId(): string {
  if (typeof window === "undefined") return "server";
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const next = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, next);
    return next;
  } catch {
    return "unavailable";
  }
}

function currentAppSlug(): "app" | "drop" | "warplets" | "million" {
  if (typeof window === "undefined") return "app";
  const hostname = window.location.hostname.toLowerCase();
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  if (isWarpletsAppHostname(hostname) || pathname === WARPLETS_APP_PATH || pathname.startsWith(`${WARPLETS_APP_PATH}/`)) {
    return "warplets";
  }
  if (hostname.startsWith("drop-") || hostname === "drop.10x.meme" || pathname === "/drop" || pathname.startsWith("/drop/")) {
    return "drop";
  }
  if (hostname.startsWith("million-") || hostname === "million.10x.meme" || pathname === "/million" || pathname.startsWith("/million/")) {
    return "million";
  }
  return "app";
}

export function trackAppEvent(name: AnalyticsEventName, context: AnalyticsContext = {}): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  const sanitized = Object.fromEntries(
    Object.entries(context).filter(([, value]) => typeof value === "string" && value.length <= 120),
  );
  window.gtag("event", name, {
    ...sanitized,
    app_slug: currentAppSlug(),
    anonymous_session_id: anonymousSessionId(),
  });
}
