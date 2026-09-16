/**
 * Development-only service worker neutralization.
 *
 * `npm run dev` and `npm start` share an origin (`127.0.0.1:30141`), so a worker
 * registered by a production run keeps controlling dev pages afterwards, and
 * `public/sw.js` answers `/_next/static/*` cache-first straight out of Cache
 * Storage — that path ignores `Cache-Control`, so stale chunks and a stale app
 * shell survive HMR and reloads.
 *
 * Two layers keep dev clean:
 *
 * 1. `next.config.ts` answers `/sw.js` with `DEV_SERVICE_WORKER_SOURCE` while
 *    developing (a `beforeFiles` rewrite to `/api/dev-sw`, declared inline there
 *    so the config stays a plain Node ESM module). A leftover production
 *    registration replaces itself with a self-unregistering worker on its next
 *    update check, wipes the caches, and disappears — even if the page never
 *    boots the app.
 * 2. `DEV_SW_RESET_SCRIPT` runs inline while the document is still parsing, so
 *    the tab repairs itself without waiting for the app to boot: it unregisters
 *    workers, clears Cache Storage, and reloads the document once so no cached
 *    chunk survives that first paint.
 *
 * Production is untouched: no rewrite, the real `public/sw.js`, no inline script.
 */

/**
 * Served by `/api/dev-sw` in dev, which is what `next.config.ts` rewrites
 * `/sw.js` to. `beforeFiles` matters there: the `public/sw.js` static file would
 * win an `afterFiles` rewrite.
 */
export const DEV_SERVICE_WORKER_SOURCE = `// Development-only worker: replaces any production worker left over on this origin.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      await self.clients.claim();
    })(),
  );
});
`;

/**
 * Inline `<head>` script, parsed before the app's own scripts run. Like Next's
 * theme script it cannot beat the `<script async>` chunk prefetches Next emits
 * above it, which is why it reloads once after cleaning.
 * The `sessionStorage` marker keeps a failing reload from looping, and it is
 * cleared again on the first clean load so the next production run self-heals too.
 */
export const DEV_SW_RESET_SCRIPT = `(function () {
  var KEY = 'pi-web-dev-sw-reset';
  if (!('serviceWorker' in navigator) || typeof caches === 'undefined') return;
  Promise.all([navigator.serviceWorker.getRegistrations(), caches.keys()])
    .then(function (results) {
      var registrations = results[0];
      var cacheKeys = results[1];
      if (registrations.length === 0 && cacheKeys.length === 0) {
        try { sessionStorage.removeItem(KEY); } catch (error) {}
        return;
      }
      var reload = true;
      try {
        reload = sessionStorage.getItem(KEY) !== '1';
        sessionStorage.setItem(KEY, '1');
      } catch (error) {
        // No per-tab marker available, so a reload could loop. Still clean up.
        reload = false;
      }
      Promise.all([
        Promise.all(registrations.map(function (registration) {
          return registration.unregister();
        })),
        Promise.all(cacheKeys.map(function (key) {
          return caches.delete(key);
        })),
      ]).then(function () {
        if (reload) location.reload();
      }, function () {
        if (reload) location.reload();
      });
    })
    .catch(function () {
      // Storage can be blocked; the app still works without the cleanup.
    });
})();
`;
