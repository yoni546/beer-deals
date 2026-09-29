# Design critique — "The Tape" at release 0.6.0

Written by the person who built it, against `PRODUCT.md`/`DESIGN.md` and the audit's acceptance criteria, looking at
`docs/design/screens/` and at every screen in a browser at 390×844 and 430×932, light and dark, in several themes.
It is not an independent review and it is not a substitute for looking at the app on a real phone (see "Not checked").
Priorities: **P0** blocks use · **P1** breaks the promise of the product · **P2** worth fixing soon · **P3** polish.

**P0 / P1: none found.** The Impeccable detector prints `[]`; axe finds no WCAG A/AA violation on the ten public
screens; every control is ≥ 44 px; nothing scrolls sideways at 360/390/430/768.

## What earns its place

* **One memorable idea, used everywhere it makes sense.** The counter and the paper strip are the whole system. The
  strips have perforated edges, prices are printed like shelf labels (raised agorot), the headline deal is the
  receipt's total, and anything stale or unverified is hatched *and* labelled. Nothing else is decorative.
* **The theme is the product's personality, not a skin.** Picking beer #1 in onboarding repaints the page at once;
  22 looks are generated with guaranteed contrast rather than hand-tuned.
* **Honest numbers.** A percentage appears only when the database vouched for it, always as "−34%" with the minus on
  the correct side of the figure; no verified reference means the price stands alone.
* **Hierarchy that survives a glance in an aisle:** beer name → price → chain → the saving; details fold away.

## P2 — worth fixing soon

1. **Too many controls before the list.** On Home the sort row and the pack row (about 130 px) sit between the headline
   deal and the first strip; on a store page there are three control rows. A single "מיון וסינון" control that opens a
   sheet would give the list back its space. (Deliberately not done yet: it needs script and a focus-trapping sheet, and
   the current chips work with no JavaScript.)
2. **Lines are tall.** Every offer line is three rows (~136 px) so that each target is 44 px; about four lines fit on a
   screen. A compact mode, or moving the store into the first row on Home, would double the density.
3. ~~Manual theme names describe a mood, not a beer.~~ *Superseded in 0.6.0: there is no manual look any more; favourite #1 is the app.*
4. **The regular-prices view has no search**, and the beer list / store list are separate searches from Home's combined box.

## P3 — polish

* ~~The zero-result search state gives advice but no button.~~ *Fixed in 0.5.2.*
* `filter: drop-shadow` follows the perforated edges; on a very long page on a low-end phone it may cost scroll
  smoothness. Measure before optimising.
* No pull-to-refresh or explicit refresh control; "עודכן לפני…" is the only freshness cue on the page.
* The build badge in development sits over the top-left corner and hides the first pixels of the header.

## 0.6.0 — the bottle-led identity, reviewed

Question asked: does The Tape support "my beer deals app" rather than "one design with different colour tokens"?
**Yes, with the bottle on the counter.** Kept: hierarchy, shelf-label prices, navigation, accessibility, ergonomics.
Changed: the counter now carries favourite #1's bottle and the beer's own colours; the same bottle, small, marks every
beer by name. Five #1 beers side by side (`screens/favourite-one/_comparison-home-*.png`) are five recognisably
different apps on one layout.

* **P2 — the big bottle is subtle in dark mode.** The readability guarantee confines it to the dark end of the
  range on a dark counter; it reads as a lit bottle in a dim bar, not a poster. Light mode shows more of it. This
  is the honest cost of "text is never unreadable over the bottle"; a real photo will help (more tonal detail).
* **P2 — much of the bottle is behind the tape.** The paper strips cover the counter, so the bottle is seen in the
  header zone and in the gaps. A taller Home header ("stage") would show more; not done, to keep search, the #1
  beer and the tab bar on the first screen (acceptance 11).
* **P3 — drawn bottles are stand-ins.** They carry glass, cap and label colours and the right silhouette, but no
  marks, by design. Licensed photos (`scripts/prepare-bottle.mjs`) are the real thing.
* Impeccable detector: `[]` after the change.

## Not checked (and why it matters)

* **No real device.** Everything above was seen in Chromium (Playwright's build and installed Chrome). Not seen:
  **iOS Safari**, Android Chrome on a real phone, Firefox, a screen reader, a low-end CPU. The perforated edges use CSS
  `mask-image` and the category picker uses `:has()`; both are supported by current iOS Safari, but "should work" is not
  "looked at it".
* **Hebrew typography on Android and iOS** (Rubik is loaded from Google Fonts at build time and self-hosted; the
  system fallback was not inspected).
* **Colour under sunlight and on OLED**: the contrast ratios are computed, not judged by eye in a shop.
* **The admin panel** was restyled by a delegated task and visually checked at 390 px once; it is outside the
  automated touch-target scan.
