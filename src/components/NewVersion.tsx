"use client";

import { useEffect, useState } from "react";

/**
 * "There is a new version" (Phase Y: update strategy).
 *
 * THE FAILURE THIS CLOSES. A deploy replaces the server while a phone still has
 * the previous build's JavaScript on screen — an installed PWA can hold a tab for
 * days. The old bundle then posts a Server Action the new server has never heard
 * of, which is where "Failed to find Server Action" came from, and from there the
 * generic error screen. `public/sw.js` records that history in its own comments;
 * `/api/version` was built to detect it and nothing ever called it.
 *
 * IT NEVER RELOADS BY ITSELF. Somebody halfway through typing a deal would lose
 * it, and a page that reloads under your hands is worse than a stale one. It
 * offers, once, and they choose.
 *
 * IT DOES NOT POLL. The check runs when the tab becomes visible again — which is
 * exactly when a PWA comes back from the background, and the moment that matters.
 * A timer would spend a phone's battery asking a question whose answer only
 * changes on a deploy.
 */
export function NewVersion({ current }: { current: string }) {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (stale) return;
    let cancelled = false;

    async function check() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { version } = (await res.json()) as { version?: string };
        // Only a DIFFERENT version, not a newer one: a rollback is also a reason to
        // stop running the build that is no longer there.
        if (!cancelled && version && version !== current) setStale(true);
      } catch {
        // Offline, or the endpoint is down. Neither is news worth showing.
      }
    }

    document.addEventListener("visibilitychange", check);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", check);
    };
  }, [current, stale]);

  if (!stale) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+4.75rem)]"
    >
      <div className="mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-paper-line bg-paper px-4 py-3 shadow-lg">
        <p className="min-w-0 text-sm text-ink">יצאה גרסה חדשה של האפליקציה.</p>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => location.reload()} className="btn">
            רענון
          </button>
          <button
            type="button"
            onClick={() => setStale(false)}
            aria-label="סגירה"
            className="min-h-11 min-w-11 text-sm font-semibold text-ink-2"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
