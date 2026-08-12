export type EntryPoint =
  | "browser"
  | "pwa"
  | "x-webview"
  | "10x-tabs"
  | "telegram"
  | "discord"
  | "agent";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export function resolveEntryPoint(
  locationLike: Pick<Location, "search">,
  options: { standalone?: boolean; referrer?: string; userAgent?: string } = {},
): EntryPoint {
  const source = new URLSearchParams(locationLike.search).get("source")?.toLowerCase();
  if (source === "10x-tabs") return "10x-tabs";
  if (source === "telegram") return "telegram";
  if (source === "discord") return "discord";
  if (source === "agent") return "agent";
  if (source === "x" || source === "twitter") return "x-webview";
  if (source === "pwa" || options.standalone) return "pwa";
  const referrer = options.referrer?.toLowerCase() ?? "";
  const userAgent = options.userAgent?.toLowerCase() ?? "";
  if (referrer.includes("t.co/") || referrer.includes("x.com/") || userAgent.includes("twitter")) return "x-webview";
  return "browser";
}

export function isStandaloneDisplay(): boolean {
  return typeof window !== "undefined" && (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

export function isEmbeddedWebView(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent.toLowerCase();
  return /twitter|telegram|discord|farcaster|warpcast|coinbasewallet|baseapp/.test(ua);
}

export function isLikelyBaseAppBrowser(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const ua = navigator.userAgent.toLowerCase();
  const referrer = document.referrer.toLowerCase();
  const provider = (window as Window & { ethereum?: { isCoinbaseWallet?: boolean } }).ethereum;
  const mobileCoinbaseProvider = /iphone|ipad|ipod|android/.test(ua) && provider?.isCoinbaseWallet === true;
  return /coinbasewallet|baseapp/.test(ua) || referrer.startsWith("https://base.app/") || mobileCoinbaseProvider;
}

export function initializePwa(): void {
  if (typeof window === "undefined") return;
  document.documentElement.dataset.entryPoint = resolveEntryPoint(window.location, {
    standalone: isStandaloneDisplay(),
    referrer: document.referrer,
    userAgent: navigator.userAgent,
  });
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    window.dispatchEvent(new CustomEvent("10x:pwa-install-available"));
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    window.dispatchEvent(new CustomEvent("10x:pwa-installed"));
  });
  window.addEventListener("load", () => void getServiceWorkerRegistration(), { once: true });
}

export function canPromptPwaInstall(): boolean {
  return Boolean(deferredInstallPrompt && !isEmbeddedWebView() && !isStandaloneDisplay());
}

export async function promptPwaInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const prompt = deferredInstallPrompt;
  if (!prompt || isEmbeddedWebView() || isStandaloneDisplay()) return "unavailable";
  await prompt.prompt();
  const result = await prompt.userChoice;
  if (result.outcome === "accepted") deferredInstallPrompt = null;
  return result.outcome;
}

export function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (registrationPromise) return registrationPromise;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return Promise.resolve(null);
  registrationPromise = navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then((registration) => {
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent("10x:pwa-update-available"));
          }
        });
      });
      return registration;
    })
    .catch((error) => {
      console.warn("10X service worker registration failed", error);
      return null;
    });
  return registrationPromise;
}

export async function activatePwaUpdate(): Promise<boolean> {
  const registration = await getServiceWorkerRegistration();
  if (!registration?.waiting) return false;
  registration.waiting.postMessage({ type: "SKIP_WAITING" });
  return true;
}

function urlBase64ToUint8Array(value: string): Uint8Array {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const decoded = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export async function subscribeToWebPush(topics: string[] = ["announcements"]): Promise<PushSubscription> {
  if (!("Notification" in window) || !("PushManager" in window)) throw new Error("Web Push is not supported in this browser.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "Notification permission was denied." : "Notification permission was not granted.");
  const registration = await getServiceWorkerRegistration();
  if (!registration) throw new Error("The 10X service worker is unavailable.");
  const keyResponse = await fetch("/api/web-push/public-key", { headers: { accept: "application/json" } });
  const keyPayload = await keyResponse.json() as { publicKey?: string; error?: string };
  if (!keyResponse.ok || !keyPayload.publicKey) throw new Error(keyPayload.error || "Web Push is not configured.");
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: new Uint8Array(urlBase64ToUint8Array(keyPayload.publicKey)).buffer,
  });
  const response = await fetch("/api/web-push/subscriptions", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON(), topics }),
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || "The Web Push subscription could not be saved.");
  return subscription;
}

export async function unsubscribeFromWebPush(): Promise<void> {
  const registration = await getServiceWorkerRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await fetch("/api/web-push/subscriptions", {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  await subscription.unsubscribe();
}
