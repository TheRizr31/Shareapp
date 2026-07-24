/* Service worker — rend l'app installable et démarrable hors ligne.
   L'API n'est jamais mise en cache : on ne veut pas d'addition périmée. */
const CACHE = "partage-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(["/", "/index.html", "/manifest.json", "/icone.svg"]))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((k) => Promise.all(k.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/")) return;          // jamais en cache
  if (url.origin !== location.origin) return;            // CDN : laisser passer

  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("/index.html")));
    return;
  }
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
