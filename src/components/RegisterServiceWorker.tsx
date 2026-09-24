"use client";

import { useEffect } from "react";

/**
 * Registers the service worker. Rendered once in the root layout.
 *
 * Registration is deliberately deferred to the `load` event: on a cold open the
 * browser is already fetching everything the first screen needs, and competing
 * with it delays the thing the user actually came for.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
        console.error("[pwa] service worker registration failed:", error);
      });
    };

    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
