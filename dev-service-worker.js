// Development Service Worker - Bypasses Caching for local files, caches CDNs
console.log("Development Service Worker active - caching only CDNs");

const DEV_CDN_CACHE = "dev-cdn-cache";
const CDN_ORIGINS = [
  "https://cdn.jsdelivr.net",
  "https://cdnjs.cloudflare.com",
  "https://unpkg.com"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== DEV_CDN_CACHE) {
            console.log("Deleting non-CDN cache:", cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isCDN = CDN_ORIGINS.some(origin => url.origin === origin);

  if (isCDN) {
    // Cache-first strategy for CDNs
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(DEV_CDN_CACHE).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        });
      })
    );
  } else {
    // Network-only strategy for local files (ensures reloads show latest changes)
    event.respondWith(fetch(event.request));
  }
});
