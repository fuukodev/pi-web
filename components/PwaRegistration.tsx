"use client";

import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      // A service worker left over from a production run caches `/_next/static/*`
      // cache-first. Dev chunk URLs are stable across recompiles, so that stale
      // cache would keep serving old code after HMR. Dev must not keep it, and
      // its cache entries have to go with it.
      void navigator.serviceWorker.getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .then(() => (typeof caches === "undefined"
          ? undefined
          : caches.keys().then((keys) => Promise.all(
            keys.filter((key) => key.startsWith("pi-web-")).map((key) => caches.delete(key)),
          ))))
        .catch(() => {
          // Storage can be blocked; the app still works without the cleanup.
        });
      return;
    }

    const register = () => {
      const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
      const scriptUrl = `/sw.js?v=${encodeURIComponent(appVersion)}`;

      void navigator.serviceWorker.register(scriptUrl, {
        scope: "/",
        updateViaCache: "none",
      }).catch((error: unknown) => {
        console.error("Failed to register the Pi Web service worker:", error);
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
