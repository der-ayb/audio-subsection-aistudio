importScripts(
  "https://storage.googleapis.com/workbox-cdn/releases/7.3.0/workbox-sw.js",
);

if (workbox) {
  workbox.setConfig({ debug: false });

  // Force waiting service worker to become active
  self.skipWaiting();
  workbox.core.clientsClaim();

  // Precache critical files with revisions
  workbox.precaching.precacheAndRoute(
    [
      { url: "./", revision: "1" },
      { url: "./index.html", revision: "1" },
      { url: "./app.html", revision: "1" },
      { url: "./manifest.json", revision: "1" },
      { url: "./src/style.css", revision: "1" },
      { url: "./src/script.js", revision: "1" },
      { url: "./install.js", revision: "1" },
      { url: "./assets/quran.sqlite", revision: "1" },
      {
        url: "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.rtl.min.css",
        revision: "1",
      },
      {
        url: "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css",
        revision: "1",
      },
      {
        url: "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js",
        revision: "1",
      },
      {
        url: "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.js",
        revision: "1",
      },
      {
        url: "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.wasm",
        revision: "1",
      },
      {
        url: "https://cdnjs.cloudflare.com/ajax/libs/tone/15.3.5/Tone.js",
        revision: "1",
      },
    ],
    {
      ignoreURLParametersMatching: [/.*/],
    },
  );

  // Serve Cached Resources
  workbox.routing.registerRoute(
    ({ url }) => url.origin === self.location.origin,
    new workbox.strategies.CacheFirst({
      cacheName: "static-cache",
      plugins: [
        new workbox.expiration.ExpirationPlugin({
          maxAgeSeconds: 7 * 24 * 60 * 60, // Cache static resources for 7 days
        }),
      ],
    }),
  );

  // Cache-first for CDN files (Bootstrap, Icons, SQL.js, Tone.js)
  workbox.routing.registerRoute(
    ({ url }) =>
      url.origin === "https://cdnjs.cloudflare.com" ||
      url.origin === "https://cdn.jsdelivr.net" ||
      url.origin === "https://fonts.googleapis.com" ||
      url.origin === "https://fonts.gstatic.com",
    new workbox.strategies.StaleWhileRevalidate({
      cacheName: "cdn-cache",
      plugins: [
        new workbox.expiration.ExpirationPlugin({
          maxAgeSeconds: 30 * 24 * 60 * 60,
          maxEntries: 100,
        }),
      ],
    }),
  );

  // Serve HTML pages with Network First and offline fallback
  workbox.routing.registerRoute(
    ({ request }) => request.mode === "navigate",
    async ({ event }) => {
      try {
        const response = await workbox.strategies
          .networkFirst({
            cacheName: "pages-cache",
            plugins: [
              new workbox.expiration.ExpirationPlugin({
                maxEntries: 50,
              }),
            ],
          })
          .handle({ event });
        return response || (await caches.match("./index.html"));
      } catch (error) {
        return await caches.match("./index.html");
      }
    },
  );

  // Clean up old/unused caches during activation
  self.addEventListener("activate", (event) => {
    const currentCaches = [
      workbox.core.cacheNames.precache,
      "cdn-cache",
      "static-cache",
      "pages-cache",
    ];

    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (!currentCaches.includes(cacheName)) {
              return caches.delete(cacheName);
            }
          }),
        );
      }),
    );
  });
}
