/**
 * Minimal service worker — exists only so the PWA is installable.
 * Network-only fetch: localhost / tiny C-server must always reflect live files.
 * No cache-first, no precache.
 */
const SW_VERSION = "ga-pdf-editor-sw-network-only-v1";

self.addEventListener("install", (event) => {
  // Activate immediately on first install / update
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop any accidental old caches from prior experiments
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
      console.log("[sw]", SW_VERSION, "active (network-only)");
    })()
  );
});

// Do not intercept fetch — browser hits the origin (localhost) directly.
// (If a browser still requires a fetch handler for "installability", keep it
//  as a pure pass-through without caching.)
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
