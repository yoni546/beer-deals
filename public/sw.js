/*
 * Service worker.
 *
 * Deliberately small. The pages here are personalised and their prices change,
 * so caching HTML would risk showing someone yesterday's price in a supermarket
 * aisle — the one failure this app cannot afford. So: never cache navigations.
 * Cache only the static shell assets, and keep an offline page to show when the
 * network is gone.
 *
 * What this worker is really for is push. Web Push on Android and on installed
 * iOS PWAs only works through a service worker, and that is the reason it
 * exists at all.
 */

const CACHE = "beer-deals-v1";
const OFFLINE_URL = "/offline.html";

const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      // A missing icon must not stop the worker installing; push would break
      // with it.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Always live. Fall back to the offline page only when the network fails.
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (url.pathname.startsWith("/icons/") || url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "מבצע חדש";
  const options = {
    body: payload.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    dir: "rtl",
    lang: "he",
    // Collapse repeats: two pushes about the same offer show as one. (The server sends the tag.)
    tag: payload.tag || (payload.dealId ? `deal-${payload.dealId}` : "deal"),
    renotify: false,
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // A notification only ever opens a page of this app. Payloads come from our own signed
  // server, but the worker does not need to take that on trust: anything off-site goes home.
  const requested = new URL(event.notification.data?.url || "/", self.location.origin);
  const target = (requested.origin === self.location.origin ? requested : new URL("/", self.location.origin)).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const ours = windows.filter((client) => new URL(client.url).origin === self.location.origin);

      // Reuse the tab the person is actually looking at rather than piling up new
      // ones — and never a background tab they were not using.
      const candidate =
        ours.find((client) => client.focused) ?? ours.find((client) => client.visibilityState === "visible");

      if (candidate) {
        try {
          const navigated = await candidate.navigate(target);
          return await (navigated ?? candidate).focus();
        } catch {
          // navigate() refuses windows this worker does not control. Fall through.
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
