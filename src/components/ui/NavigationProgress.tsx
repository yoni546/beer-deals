"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

/** Only show the bar when an answer takes longer than a blink. */
const SHOW_AFTER_MS = 150;
/** Never leave it running: if nothing arrives by now the page is not going to. */
const GIVE_UP_MS = 12_000;

/**
 * The loading state for a tap: a thin bar along the top edge, plus a spoken "טוענים…".
 *
 * There is deliberately no route-level `loading.tsx` skeleton. With Next.js 15.5 a
 * `loading.tsx` in front of a large dynamic page makes client-side navigation stall in
 * production builds (the RSC request is cancelled and the URL never changes; reproduced
 * with a bare test app, see docs/LESSONS.md). The old page staying put until the new one
 * arrives is also the calmer behaviour on a slow shop network: nothing jumps.
 *
 * It starts on a same-origin link click that would change the URL, and stops when the
 * path or query string changes.
 */
export function NavigationProgress() {
  return (
    <Suspense fallback={null}>
      <Bar />
    </Suspense>
  );
}

function Bar() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [shown, setShown] = useState(false);
  const showTimer = useRef<number | undefined>(undefined);
  const giveUpTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const stop = () => {
      window.clearTimeout(showTimer.current);
      window.clearTimeout(giveUpTimer.current);
      setShown(false);
    };

    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      window.clearTimeout(showTimer.current);
      window.clearTimeout(giveUpTimer.current);
      showTimer.current = window.setTimeout(() => setShown(true), SHOW_AFTER_MS);
      giveUpTimer.current = window.setTimeout(stop, GIVE_UP_MS);
    };

    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      stop();
    };
  }, []);

  // The address changed: the answer has arrived.
  useEffect(() => {
    window.clearTimeout(showTimer.current);
    window.clearTimeout(giveUpTimer.current);
    setShown(false);
  }, [pathname, search]);

  if (!shown) return null;
  return (
    <div role="status" className="nav-progress">
      <span className="sr-only">טוענים…</span>
    </div>
  );
}
