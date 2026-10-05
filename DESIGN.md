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

- **Primitives** per beer (`BEER_IDENTITIES` in `src/design/themes.ts`), in OKLCH: counter
  hue/chroma, accent hue/chroma, light direction — taken from the beer's own colours — plus its
  **bottle** (silhouette, glass, cap, neck foil, label colours) and where the bottle stands.
- **Semantic tokens** (identical names in every theme, both modes):
  `ground · ground-2 · ground-line · on-ground · on-ground-2 · accent · glow` (the counter),
  `paper · paper-2 · paper-line · ink · ink-2 · price · deal · on-deal` (the tape),
  `focus · danger`.
- **Guaranteed contrast.** The generator moves lightness until each text role passes: text on
  paper ≥ 4.5:1, price ink on paper ≥ 5:1, text on the counter ≥ 4.5:1, deal chip ≥ 4.5:1, focus
  ring ≥ 3:1 on both. A theme that cannot pass does not build (`tests/design.test.ts`).
- **Light and dark** are both generated from the same primitives; the phone's setting chooses.
  There is no in-app switch.
- **Distinct on purpose.** No two beers may sit closer than a set OKLab distance on counter, accent
  and label (`tests/design.test.ts`).
- **Identity, not trade dress.** A beer's colours are its own (Goldstar's black and gold, Heineken's
  green and red), but no logo, wordmark or label artwork is ever drawn or copied.

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
- **Motion.** Two authored moments: the print-in of a strip on first paint (whole line-heights, a
  single overshoot), and the first run's stage (below). Everything else is instant. Fully disabled
  under `prefers-reduced-motion`.

## Favourite #1 is the app: the bottle on the counter

**Permanent rule:** `favourite #1 → beer identity → bottle on the counter → colour tokens`, through
`getThemeForBeer(favourite #1)` and nothing else. No picker, no override (a test fails if one appears).

- **The bottle** stands on the counter behind the tape: fixed while the paper scrolls over it, off-centre
  at the left (the end of a right-to-left line, where the least text sits), its neck, shoulder and label
  in the open counter beside the right-aligned title, cropped by the screen edge, with a vignette and a
  reading-side scrim for depth and a depth-of-field blur so no label detail competes with text.
- **Readability by construction.** Before display the bottle passes through a tone filter that maps
  every colour channel into [lo, hi] (a gamma curve: dark mode lifts the glass off the black counter,
  light mode deepens it). The range is the widest in which every counter text keeps ≥ 4.5:1 over *any*
  bottle pixel; `tests/design.test.ts` proves it for every beer in both modes, and that the range is
  wide enough for the bottle to be clearly visible.
- **The real bottle.** 19 beers show their own product photo — the bottle as sold in Israel, background
  removed by an edge flood fill, the bottle's pixels untouched, 26–87 KB WebP, only favourite #1's ever
  requested. `scripts/fetch-bottles.mjs` lists every source (17 retailer pack shots found by the barcode
  the price feeds carry, 1 Wikimedia Commons photo) and `src/design/bottle-photos.json` records source URL,
  licence, approval and barcode. Desperados and Bazelet have no usable photo yet and keep a bottle drawn
  from data (silhouette, glass, cap and label colours, no marks) — never another beer's photo.
- **The same bottle, small,** sits beside the beer's name on the favourite keys, beer strips, the headline
  deal, the beer list and the favourites editor, so a beer is recognised before its name is read.
- **One layout for every beer.** Only the counter, the bottle and the accent change; spacing, type and
  components are identical. The neutral **house** look (no bottle) covers onboarding before a pick and any
  beer without an identity (Somersby, a cider, deliberately).

## The stage (0.7.1)

The background is a composition, always the same, only the beer changes: **one hero bottle** of favourite
#1, centred and large, its label in the upper third of the screen (the cap runs off the top — a close-up),
and **two smaller bottles of the same beer** behind it at the sides, softer and tilted outward. The hero is
almost in focus (the label reads); the sides are further back. Home leaves an open **stage** under the
greeting where nothing covers the hero, with a small caption ("הבירה שלכם · גולדסטאר") that links to the
beer; onboarding's last step does the same. The tone filter still guarantees contrast for every counter
text over any bottle pixel; a top scrim keeps the greeting calm over the label.

## The first run (0.10.0)

Onboarding is four short steps under one **stage**: the bottles themselves, standing on the counter
(`OnboardingStage`, `src/app/welcome/onboarding.css`).

- **name** — one unlabelled bottle (amber glass, blank paper label: nobody's beer yet), centre stage.
- **pick** — its cap comes off and it steps to the head of a line of four. Each beer chosen turns into
  place as its own real bottle; the first one chosen takes the page's colours at once.
- **rank** — the same list as Settings (`RankedBeers`: grip or arrows). The line re-forms with every
  move; #1 stands tallest, and the palette follows it.
- **reveal** — the other three step back, #1 leans over and pours itself a glass (the beer's own colour:
  `pourFor`), then stands beside it. Leaving, the counter rises over the screen and Home arrives on it.

Rules that keep it honest and fast:

- **The real bottle, as photographed.** Depth is CSS perspective on the approved photo — a slow turn and a
  band of light masked by the photo's own outline. No 3D model (it would mean redrawing the label), no
  WebGL, no new dependency. A beer without a photo uses its drawn bottle; one without an identity, the
  blank bottle.
- **Motion never blocks.** Every button works while something is moving; the last step's button is there
  before the pour starts. Only transforms and opacity move.
- **Three levels:** full; *lite* on a weak device (no idle loops); *off* through the "בלי אנימציה" switch
  or the phone's reduced-motion setting, where every scene is simply in its final state. The switch is for
  this visit only and is not a stored preference.
- **Still one primary action per step,** minimal copy, and the stage is decorative (`aria-hidden`): the
  steps say everything in words, and each new step takes focus at its heading.

## Calm controls (0.7.1)

Sort and pack filters are ONE quiet control that names what is active ("מיון: הכי משתלם · שישיות"); the
options open under it (native `<details>`, closes once a choice is made): הכי משתלם · מהזול ליקר · מהיקר
לזול · לליטר, and הכל · שישיות · ארגזים · בודדים (Home has no בודדים). A page's own primary toggle
("הבירות שלי" on a chain page) stays in plain view.

## Kinds of pack (0.8.0)

A beer's or chain's page is three sections — שישיות, ארגזים, בודדים (`CategorySection`) — each with its
deals first and its regular prices after (`Part`, a small heading each; a kind with regular prices but no
deal says so in one quiet line). Strips are named with the pack's word and real count ("שישייה · 6×330 מ״ל
· פחית"); the container is left out when the chain did not state it.

## Where a deal runs (0.9.0)

One quiet phrase in a deal's facts row — "בכל הרשת", "בסניפים משתתפים", "גבעת שאול בלבד", "נצפה בכל 7 הסניפים
שנבדקו" — worded by `scopeHe` from the database's scope (never more than it allows). When there are branches to
list it is a dotted-underline disclosure (≥ 44 px) that opens a compact list (name · city), fetched only then
(`ScopeLine`); no branch tables on cards. Mix-and-match offers read as what the shopper does: "2 ב־₪35 · לבחירה
מהמוצרים שבמבצע" under the heading "קונים כמה, בוחרים מהמבצע".

## My beers (0.8.0)

The four beers stand on the counter, not on cards: each one's own bottle (the approved photo, else the
drawn bottle — `BeerBottle`), a small rank (#1 in the deal colour, #2–#4 quiet), the name, and a few words
only when there is a deal. The same in Settings, where the rows keep the grip (drag) and the arrow buttons
(keyboard); the look still follows #1 the moment it is saved.

A deal line has two levels: **name ····· saving · price**, then one row of facts (במקום ₪X · store · until ·
deposit · multi-buy terms). Lines are separated by solid hairlines with room above and below; strips by
space and torn edges. Nothing unfolds on an ordinary line.

## Deals, then regular prices

A beer page and a chain page are two parts in this order, never mixed: **מבצעים עכשיו** (promotions everyone
can use, pack by pack; "any N of these" group offers as one strip of their own) and **מחירים רגילים**. Jump
links at the top reach either part; one sort (price ↑ / price ↓ / best verified saving, optionally per litre)
orders both. Section headings are h2, pack or beer strips inside them h3.

Every price line says where it was seen and what it excludes, in the tape's small secondary row:
"בסניף X" or "ב־N סניפים", "החל מ־" before the figure when branches differ, and "+ ₪1.80 פיקדון". The price
itself stays the big figure; per litre is secondary.

## Things not to do

A theme picker or any other way to choose a look by hand; a raw white-background product photo, or any
photo whose background could not be removed; a redrawn or "improved" label;
rounded card stacks; gradient or glass surfaces; a beer emoji as a logo; brown-and-gold as a default;
colour as the only signal; text under 12 px; a dark mode chosen by habit; tracked caps eyebrows; a new
colour that is not a token.
