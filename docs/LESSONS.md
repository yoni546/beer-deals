# Lessons learned (engineering notes)

Short, dated notes on things that cost real time. Each says what was seen, how it was
narrowed down, and what the code does about it now.

## 2026-09-29 — `loading.tsx` stalls client-side navigation (Next.js 15.5.26)

**Seen.** After adding route-level `loading.tsx` files, every e2e spec that taps a link
which changes only the query string (`/` → `/?sort=price_asc`) failed against the
**production build**, while the same specs passed against `next dev`. In the browser the tap
did nothing: the URL never changed, no error was logged, and the network panel showed the
RSC request (`/?sort=price_asc&_rsc=…`) answered `200 text/x-component` and then
`net::ERR_ABORTED` (cancelled by the renderer, not by `AbortController`). Links to other
paths appeared to work only because Next falls back to a full page load.

**Narrowed down.** Not the service worker, not compression (`compress: false`), not the
custom `distDir`, not the middleware, not the client widgets in the layout, not the data
layer, not `generateViewport`, not real Chrome vs Playwright's Chromium. Removing the
`loading.tsx` files fixed it. A bare Next app (async layout reading cookies + one dynamic
page + `loading.js`) with a **small** page navigated fine; the same app with a page of a few
hundred rows (~50 KB of Flight payload) stalled exactly the same way, and stopped stalling
when `loading.js` was removed. So: *`loading.tsx` in front of a large dynamic page, production
build*. Not investigated further upstream.

**What the code does now.**
- No `loading.tsx` anywhere under `src/app` (`tests/no-loading-boundary.test.ts` fails if one
  appears).
- The loading state is `src/components/ui/NavigationProgress.tsx`: a thin bar along the top
  edge (and a spoken "טוענים…") that starts on a same-origin link tap and stops when the path
  or query changes. The previous page stays on screen until the new one is ready.
- The regression is covered by the e2e specs that tap sort/filter chips and the bottom bar;
  they must run against a **production build** (CI does; `E2E_DEV=1` hides this class of bug).

**If you want to try `loading.tsx` again**, upgrade Next first, then run the whole e2e suite
without `E2E_DEV`, and check that `tests/e2e/redesign.spec.ts › sorting lives in the URL` passes.
