/**
 * The trolley that fills while the app opens (the owner's idea, 2026-10-25).
 *
 * WHERE IT RUNS, AND WHY ONLY THERE. `@media (display-mode: standalone)` — the
 * installed app, never a browser tab. Opening the app from the home screen gives
 * you a blank screen for a moment while the OS hands over; that moment already
 * exists and already shows nothing, so filling it costs nobody anything. In a
 * tab there is no such gap, and an overlay would be covering content that was
 * ready — which is the one thing DESIGN.md says motion must never do.
 *
 * NO JAVASCRIPT. The markup is server-rendered and the whole thing is CSS: it
 * animates once and ends with `pointer-events: none` and zero opacity, so there
 * is nothing to dismiss, nothing to time out, and no way for it to get stuck in
 * front of the app if a script fails. That is also why it cannot be "while
 * loading" — it does not know what loading is. It is a fixed, short moment.
 *
 * Reduced motion removes it entirely rather than freezing a trolley mid-air.
 *
 * Drawn in the icon set's own hand (globals.css `.ico`): one 1.75px stroke,
 * round caps, no fill, currentColor. No new asset — it is a few dozen bytes of
 * SVG, and it inherits whichever beer's theme is showing.
 */
export function LaunchScreen() {
  return (
    <div className="launch" aria-hidden>
      <svg className="launch-art" viewBox="0 0 120 84" width="200" height="140" focusable="false">
        {/* The trolley: basket, handle, two wheels. Drawn FIRST so the packs
            land in front of its rim and read as being inside it rather than
            stacked behind. */}
        <path d="M30 42h52l-5 20H35z" />
        <path d="M30 42 26 30h-9" />
        <circle cx="42" cy="70" r="4" />
        <circle cx="72" cy="70" r="4" />

        {/* Three six-packs, dropping in one after another. The necks are the
            three short strokes on top — a six-pack read at this size is a box
            with bottles in it, and any more detail turns to mud. */}
        <g className="launch-packs">
          <g className="launch-pack launch-pack-1">
            <rect x="36" y="34" width="18" height="14" rx="2" fill="var(--ground)" />
            <path d="M40 34v-3M46 34v-3M50 34v-3" />
          </g>
          <g className="launch-pack launch-pack-2">
            <rect x="57" y="34" width="18" height="14" rx="2" fill="var(--ground)" />
            <path d="M61 34v-3M67 34v-3M71 34v-3" />
          </g>
          <g className="launch-pack launch-pack-3">
            <rect x="46" y="18" width="18" height="14" rx="2" fill="var(--ground)" />
            <path d="M50 18v-3M56 18v-3M60 18v-3" />
          </g>
        </g>
      </svg>
    </div>
  );
}
