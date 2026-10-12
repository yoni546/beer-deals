"use client";

import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

/**
 * The movement between screens.
 *
 * WHY NOT VIEW TRANSITIONS. `@view-transition` in globals.css animates DOCUMENT
 * navigations, and almost nothing in this app is one: the App Router answers a tap
 * with a client-side render, so the browser never swaps a document and the rule never
 * fires. (That is why the only animated navigation until now was onboarding → Home,
 * which really is a full load.) Next.js's own view-transition support is still
 * experimental, and this project has already been taken down once by an experimental
 * navigation feature — `loading.tsx`, docs/LESSONS.md — so this is ordinary CSS on an
 * ordinary element.
 *
 * WHAT IT DOES. The page is keyed by its path, so arriving at a new screen mounts a
 * fresh element and `page-enter` plays: the content rises a few pixels and fades up,
 * once, over a quarter of a second. Changing a filter on the screen you are already on
 * (`?intent=near`, a sort, a pack size) does not re-key — the path is the same — so the
 * list updates in place instead of flashing.
 *
 * NOT ON THE FIRST SCREEN OF THE SESSION. A document load already paints the page
 * fresh; fading it in again would only delay what the browser has drawn, and it would
 * fade over the one navigation that has its own animation (onboarding → Home, where
 * the bottle travels for 780 ms). So the first path this component sees is remembered
 * and left alone, and everything navigated to afterwards animates.
 *
 * WHAT IT DOES NOT DO. It does not delay anything: the animation starts when the new
 * screen is already there. Waiting is shown by the top bar (NavigationProgress), and
 * the two are deliberately separate — one says "working", the other says "arrived".
 * Reduced motion removes it through the blanket rule in globals.css.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Where this document started. Set once, on the first render, so it survives every
  // navigation that follows — and so the server's HTML and the client's first render
  // agree (neither animates).
  const [landedOn] = useState(pathname);

  return (
    <div key={pathname} className={pathname === landedOn ? undefined : "page-enter"}>
      {children}
    </div>
  );
}
