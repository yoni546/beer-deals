# Design

<!-- impeccable:design-record 1 -->

> The durable visual decisions for **מבצעי בירה**. Product truth is in [PRODUCT.md](PRODUCT.md).
> Decided 2026-09-29 by following Impeccable's *new-work* flow for a replacement visual world,
> with the owner's written brief standing in for the interactive decision page (the owner asked
> for autonomous work). Implementation: `src/design/`, `src/components/ui/`, `src/app/globals.css`.

## The decision, in one paragraph

**The Tape.** The app is a receipt for the aisle. Every page is a strip of paper (the *tape*)
laid on a lit surface (the *counter*). Items are receipt lines — the pack on the left, dotted
leader, the price in heavy condensed figures on the right — grouped by beer, ruled off with a
perforated edge, and closed by a **total** (the best deal). The counter is where each beer gets
its atmosphere; the paper stays legible in any light. It is deliberately not a stack of rounded
cards.

## Derivation (Operate mode)

- **Mechanism.** A price-comparison tool organised around the drinker's four ranked beers,
  pack-accurate and honest about savings.
- **Scene.** A shopper at the beer shelf of an Israeli supermarket under fluorescent light, one
  hand on a phone, comparing packs against the shelf-edge label. (Bright aisle ⇒ the default is a
  **light** surface that follows the phone's setting; dark is a first-class alternative, never the
  default by habit.)
- **Cultural home.** Israeli retail print and signage.
- **Seven grounded candidates, by resonance:** 1 shelf-edge price label · 2 weekly circular with
  price bursts · 3 refrigerated cooler door with LED backlight · 4 stencilled beer case · **5
  thermal receipt / ledger** · 6 shuk hand-painted sign · 7 embossed bottle crate.
  A kiosk chalkboard menu was excluded before the roll: it contradicts the binding constraint
  "not pub-menu kitsch".
- **The roll assigned #5** (`concept-seed`, key 2ac288d5): the receipt / ledger. It survives
  navigation (tab bar = counter edge), quiet and dense content (lines), state (paper aged/fresh,
  paper jam), and a different future surface (order slips for forms, a barcode strip for sharing).

## Challengers weighed (audience identification × product clarity)

| Challenger | Verdict | What the Tape keeps or gains |
| --- | --- | --- |
| Streaming title-card wall | declined | **Raise:** the row you touch lifts and opens; everything else stays put and quiet. |
| Zoo & gardens guide map | declined | **Raise:** flat, unmodulated colour — no gradients on paper, no glass, no glow except the single atmosphere field on the counter. |
| Industrial streetwear quote grammar | declined | **Raise:** a diagonal hatch is the one mark for "do not trust this": stale, unverified or held-for-review data. Colour is never the only signal. |
| Cyclorama dawn (stage lighting) | declined | **Raise:** every atmosphere is a *named* state with a light direction, and is deep-linkable (a theme has a slug). |
| Depot blind courses | declined | **Raise:** stale data "wears thin" — old paper is visibly older and says how old. |
| Drum-machine step row | competitive (clarity) | **Raise:** the four favourites are four keys in a row; an empty slot is a dark key of invitation; the #1 key is lit. Used in onboarding, Home and Settings. |

## Colour

Strategy: **Committed.** The *counter* is the beer's colour and carries most of the screen;
the *paper* is near-neutral and carries all reading. Colour is generated, not hand-picked per
component (`src/design/`):

- **Primitives** per beer, in OKLCH: ground hue/chroma, accent hue/chroma, atmosphere direction.
- **Semantic tokens** (identical names in every theme, both modes):
  `ground · ground-2 · ground-line · on-ground · on-ground-2 · accent · glow` (the counter),
  `paper · paper-2 · paper-line · ink · ink-2 · price · deal · on-deal` (the tape),
  `focus · danger`.
- **Guaranteed contrast.** The generator moves lightness until each text role passes: text on
  paper ≥ 4.5:1, price ink on paper ≥ 5:1, text on the counter ≥ 4.5:1, deal chip ≥ 4.5:1, focus
  ring ≥ 3:1 on both. A theme that cannot pass does not build (`tests/design.test.ts`).
- **Light and dark** are both generated from the same primitives; the OS setting chooses unless the
  user overrides it in Settings.
- **Distinct on purpose.** No two beer themes may sit closer than a set OKLab distance on the
  counter and accent (`tests/design.test.ts`) — the old presets had ten amber accents.
- **No beer trade dress.** Themes are moods (lit glass, green bottle, black body, hazy wheat), not
  label palettes; nothing is sampled from any brand.

## Typography

- **Rubik** (Hebrew + Latin): all text. Workhorse UI face for an Operate surface, contemporary
  Hebrew, wide weight range.
- **Barlow Condensed** (digits and `₪`): prices, unit prices, counts — a narrow, mechanical,
  printer-like figure with tabular numerals. Prices are the hero object: large shekel figure,
  agorot as a raised superscript (`₪24⁹⁰`).
- Scale: 12 · 14 · 16 · 20 · 28 · 44. Nothing meaningful below 12 px. Line length ≤ 65ch.
- No display serif, no italic accents, no tracked-out caps eyebrows.

## Composition

- One phone-width **column** (max 30rem) centred on the counter at any size. Bottom **tab bar**
  (Deals · Beers · Stores · Me) is the counter's edge: always present, 44 px+ targets.
- **Tape sections** are paper strips with a perforated (zig-zag) top and bottom edge; the first
  strip may bleed off the top. Lines are separated by dotted rules; a heavier dashed rule is a
  *tear line* between beers.
- **Rank is size, not decoration:** the total is large; lines are dense; only the best price on a
  strip is bold.
- **Not cards.** There are no rounded-rectangle-in-rounded-rectangle stacks and no shadows-as-depth
  on content; depth is the paper lifting off the counter (one soft shadow, one offset).
- Icons: a small drawn set (`src/components/ui/icons.tsx`), one 1.75 px stroke, round caps. No emoji
  anywhere in the interface.

## Controls and states

- **Chips** filter and sort (`ערך`, `מחיר ↑`, `מחיר ↓`, `לליטר`); a **segmented** control switches
  `מבצעים | מחירים רגילים`. Selected = ink on paper, unselected = counter-coloured outline.
- **Focus** is a visible 2 px ring on every interactive element, keyboard and touch.
- **Loading** is the tape being printed: placeholder lines that step in, no spinners.
- **Empty** is blank paper with one dotted line and a next action. **Error** is a paper jam: what
  happened, and a retry.
- **Stale / unverified / review** is hatched paper plus words ("לא עודכן 9 ימים"), never colour alone.
- **Motion.** One authored moment: the print-in of a strip on first paint (whole line-heights, a
  single overshoot). Everything else is instant. Fully disabled under `prefers-reduced-motion`.

## Themes: the beer's atmosphere

Only the *counter* changes. A light source (top, side, or low) casts a soft glow of the beer's accent
onto the counter; a second, deeper band anchors the bottom. Layout, spacing, type and components are
identical across all 22 themes plus a neutral **house** theme (before onboarding). Selection:
`manual override → favourite #1 → house`. Beer pages borrow their own beer's atmosphere for the header
band only.

## Things not to do

Rounded card stacks; gradient or glass surfaces; a beer emoji as a logo; brown-and-gold as a default;
colour as the only signal; text under 12 px; a dark mode chosen by habit; tracked caps eyebrows; a new
colour that is not a token.
