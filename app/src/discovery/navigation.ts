import type { MouseEvent } from "react";
import { writeSpaHistory } from "../spaHistory";
import { isEmbeddedWebView, isLikelyBaseAppBrowser } from "../pwa";

export function isDiscoveryPath(path: string) {
  const clean = path.replace(/\/+$/, "");
  return ["/discover", "/attention", "/submit", "/backing", "/rewards", "/launch-lab", "/launch-recovery", "/wallets", "/research", "/transparency", "/status", "/admin/10x"].includes(clean) || /^\/campaign\/[0-9a-f-]{36}$/i.test(clean) || /^\/elections(?:\/[^/]+)?$/.test(clean) || /^\/token\/solana\/[^/]+$/.test(clean);
}
type Click = { button: number; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; defaultPrevented?: boolean; target?: string; download?: boolean };
export function discoveryDestination(href: string, current: string, click: Click): URL | null {
  if (click.defaultPrevented || click.button !== 0 || click.ctrlKey || click.metaKey || click.shiftKey || click.altKey || click.download || (click.target && click.target !== "_self")) return null;
  const source = new URL(current), destination = new URL(href, source);
  if (destination.origin !== source.origin || !isDiscoveryPath(destination.pathname)) return null;
  // Same-document anchors, including wallet/evidence sections, keep native scrolling.
  if (destination.pathname === source.pathname && destination.search === source.search) return null;
  // Cross-page hash navigation needs the destination's asynchronous content first.
  if (destination.hash) return null;
  return destination;
}
export function navigateDiscovery(event: MouseEvent<HTMLElement>) {
  if (!(event.target instanceof Element)) return;
  const anchor = event.target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement) || !event.currentTarget.contains(anchor)) return;
  const destination = discoveryDestination(anchor.href, window.location.href, { button: event.button, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey, defaultPrevented: event.defaultPrevented, target: anchor.target, download: anchor.hasAttribute("download") });
  if (!destination) return;
  event.preventDefault();
  writeSpaHistory(window.history, null, destination.pathname + destination.search, { mode: "push", embedded: isEmbeddedWebView() || isLikelyBaseAppBrowser() });
  window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  window.scrollTo(0, 0);
  event.currentTarget.focus({ preventScroll: true });
}
