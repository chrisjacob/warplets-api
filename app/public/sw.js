const HOME_APP_HOSTS = new Set([
  "10x.meme",
  "www.10x.meme",
  "app.10x.meme",
  "app-dev.10x.meme",
  "app-local.10x.meme",
]);
const IS_HOME_APP = HOME_APP_HOSTS.has(self.location.hostname.toLowerCase());
const APP_NAME = IS_HOME_APP ? "10X.MEME" : "10X Warplets";
const CACHE_NAME = `10x-shell-v3-${IS_HOME_APP ? "home" : "warplets"}`;
const OFFLINE_URL = IS_HOME_APP ? "/offline-10x.html" : "/offline.html";
const MANIFEST_URL = IS_HOME_APP ? "/manifest-10x.webmanifest" : "/manifest.webmanifest";
const APP_ICON = IS_HOME_APP ? "/icon.png" : "/icon_search.png";
const APP_BADGE = IS_HOME_APP ? "/splash.png" : "/splash_search.png";
const STATIC_ASSETS = [OFFLINE_URL, MANIFEST_URL, APP_ICON];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { body: event.data?.text() ?? `New from ${APP_NAME}` };
  }
  const title = payload.title || APP_NAME;
  const destination = new URL(payload.url || "/", self.location.origin);
  destination.searchParams.set("source", "web-push");
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || `Open ${APP_NAME} for the latest update.`,
    icon: payload.icon || APP_ICON,
    badge: payload.badge || APP_BADGE,
    image: payload.image,
    tag: payload.tag,
    renotify: Boolean(payload.renotify),
    data: {
      url: destination.toString(),
      notificationId: payload.notificationId || null,
      recipientKey: payload.recipientKey || null,
    },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = event.notification.data?.url || new URL("/?source=web-push", self.location.origin).toString();
  event.waitUntil((async () => {
    const notificationId = event.notification.data?.notificationId;
    const recipientKey = event.notification.data?.recipientKey;
    if (notificationId && recipientKey) {
      await fetch("/api/web-push/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationId, recipientKey }),
      }).catch(() => undefined);
    }
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(destination);
        return client.focus();
      }
    }
    return self.clients.openWindow(destination);
  })());
});
