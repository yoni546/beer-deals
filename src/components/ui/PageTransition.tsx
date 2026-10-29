"use client";

import { usePathname } from "next/navigation";
import { useState, type CSSProperties, type ReactNode } from "react";

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
 * fresh element and `page-enter` plays once. Changing a filter on the screen you are
 * already on (`?intent=near`, a sort, a pack size) does not re-key — the path is the
 * same — so the list updates in place instead of flashing.
 *
 * IT MOVES THE WAY YOU WENT (0.41.0). A rise of a few pixels was too faint to be seen
 * on a phone: the owner asked for animation between pages without knowing one was
 * there. So the new screen now slides in from the side it lies on. Hebrew reads right
 * to left, so "onward" is leftward: a deeper screen (a beer, a chain) or a tab further
 * along the bar comes in from the left, and going back or to an earlier tab comes in
 * from the right. A screen with no order to it (settings, the first visit to a path)
 * keeps the plain rise. The direction is spatial information, not decoration: it says
 * where the screen you left now is.
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
  // The screen we came from, and the side the new one enters on — worked out when the
  // path changes (React's "adjust state while rendering" pattern, not an effect, so the
  // very first frame of the new screen already has its direction).
  const [shownPath, setShownPath] = useState(pathname);
  const [offset, setOffset] = useState<string | null>(null);
  if (shownPath !== pathname) {
    setShownPath(pathname);
    setOffset(enterOffset(shownPath, pathname));
  }

  return (
    <div
      key={pathname}
      className={pathname === landedOn ? undefined : "page-enter"}
      style={offset === null ? undefined : ({ "--enter-x": offset } as CSSProperties)}
    >
      {children}
    </div>
  );
}

/** The bar's order, right to left (TabBar.tsx). */
const TABS = ["/", "/map", "/beer", "/store"];

const depth = (path: string) => path.split("/").filter(Boolean).length;
const tabOf = (path: string) => TABS.indexOf(path === "/" ? "/" : `/${path.split("/")[1]}`);

/**
 * Where the new screen comes in from: a negative offset is from the left (onward, in
 * a right-to-left app), a positive one from the right (back). Null when the two
 * screens have no order between them, which keeps the plain rise.
 */
export function enterOffset(from: string, to: string): string | null {
  if (from === to) return null;
  const onward = "-1.5rem";
  const back = "1.5rem";
  const [a, b] = [tabOf(from), tabOf(to)];
  // Within one section: deeper is onward (a list → one beer), shallower is back.
  if (a !== -1 && a === b) return depth(to) > depth(from) ? onward : back;
  // Between sections on the bar: along the bar is onward.
  if (a !== -1 && b !== -1) return b > a ? onward : back;
  return null;
}
