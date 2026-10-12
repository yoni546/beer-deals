# Giving the branches a position

`branches.latitude` / `longitude` decide whether "הכי קרוב אליי" can work at all.
Migration 0026 added them and left every one empty, on purpose. This is how they
get filled, and why nothing fills them by accident.

---

## What is there today: the town centre (migration 0045)

Every branch whose town we recognise **has** a position: the approximate centre of
that town, from `src/data/israel-cities.ts`, written by `place_branches_by_town()`
and recorded as

```
geocode_source    = 'israel-cities (town centre)'
geocode_precision = 'locality'
```

`locality` is defined in 0026 as *the city centre, not the shop*, and the app words it
that way — the branch list prints `(מרכז העיר)` beside the distance. So this answers
"is there a Rami Levy in my town, or do I drive to the next one", at the resolution of
a radius a person picks in 5 km steps, and it does not pretend to point at a door.

This is **not** the invented coordinate the rule below forbids. The forbidden thing is
a plausible, wrong, *undetectable* pin on a building that is not the shop. A town
centre is labelled as a town centre in the row, in the API and on the screen.

An import places any new branch automatically (`scripts/ingest/run.mjs`). A branch
whose town is not in the list keeps **no** position, stays out of "closest to me", and
is counted on the admin coverage screen.

A real street-level fix is still better, still worth configuring, and overrides this:
`place_branches_by_town()` only ever fills a branch that has no position at all.

## Why they were empty

The price-transparency Stores file gives a branch's **name, address and city**, and
never a coordinate. So a position has to come from a geocoder — an external service
that turns "רחוב דיזנגוף 50, תל אביב" into a point. That needs configuration, and
until it is configured this repository has no way to know where any branch is.

Before 0045, rather than approximate, the app simply said so:

- A visitor who picks "הכי קרוב אליי" is told we do not know where the branches are,
  and offered "הכי משתלם" instead. It never shows a list in some other order under a
  heading about distance.
- The admin dashboard shows how many branches are placed, how many are waiting, and
  how many have no address to look up at all.

## The one rule

**Never write a coordinate we cannot defend.**

An invented position is the single failure this product cannot absorb. A missing one
is visible everywhere — the admin count, the screen, the branch list. A wrong one is
visible nowhere, and the person it misleads is standing outside the wrong supermarket.

Four things enforce it:

1. **The default provider refuses.** With no `GEOCODER` set, every lookup returns
   nothing and the run writes nothing. An unknown provider name is an error, not a
   silent fallback.
2. **The database refuses too** (migration 0026): a coordinate without
   `geocoded_at` + `geocode_source`, a point outside Israel, an unrecognised precision,
   or half a pair are all rejected by CHECK constraints.
3. **The runner refuses an implausible answer** before it reaches the database.
4. **Dry run is the default.** Nothing is written without `--apply`.

## Running it

```bash
# say what it WOULD do
node scripts/ingest/geocode.mjs --target staging

# a slice, to see the quality before committing to a full run
node scripts/ingest/geocode.mjs --target staging --limit 50
node scripts/ingest/geocode.mjs --target staging --store rami-levy

# write
node scripts/ingest/geocode.mjs --target staging --apply
```

Only branches with **no position yet** are looked up, so a re-run is cheap and the
provider's rate limit is respected. Production follows
`docs/PRODUCTION-HANDOFF-YONI.md`: `APP_ENV=production` in `.env.production.local`
**and** `--confirm-ref`, like every other writer here.

## Configuring a provider

In the target's git-ignored env file (`.env.staging.local` / `.env.production.local`),
never in the shell:

```
GEOCODER="nominatim"
GEOCODER_CONTACT="you@example.com"
```

### nominatim (OpenStreetMap) — the one that is implemented

**No API key, no account, no cost.** Good for Israeli towns and main streets; weaker
for a specific unit inside a mall, which is why anything short of a house number is
recorded as `street` or `locality` rather than dressed up as a rooftop fix.

Its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) is the
price, and the code keeps to it:

- **One request per second**, enforced in the provider rather than merely documented.
- **An identifying User-Agent with a contact address.** `GEOCODER_CONTACT` is
  required; the run refuses without it. An unidentified bulk client is how a project
  gets the whole service blocked.
- **No heavy bulk use.** About 1,100 branches at one per second is roughly twenty
  minutes, run once and then only for branches that are new. Re-geocoding the whole
  estate nightly would not be within what the policy contemplates.

### If it is not good enough

Google's Geocoding API is the usual next step: much better unit-level coverage in
Israeli malls and shopping centres, roughly **$5 per 1,000 requests** at the time of
writing, and it needs an API key and a billing account. Adding it is one file in
`scripts/ingest/lib/geocode/` and one line in `PROVIDERS` — the interface was drawn
so the choice is a configuration line, not a rewrite.

## The provider interface

```js
{
  name: "nominatim",
  configured: true,            // false ⇒ the runner explains and writes nothing
  note: "…",                   // shown at the top of a run
  async geocode(address, city, signal) {
    return { lat, lon, precision } | null;   // null = "I could not place this"
  }
}
```

`precision` is one of:

| value | meaning | how the app words it |
|---|---|---|
| `rooftop` | the building | the branch's own position |
| `street` | the road, not the number | close enough for a radius |
| `locality` | **the town centre, not the shop** | said as the town, never as the shop |

A provider that cannot tell must return `locality`. Overstating precision is worse
than admitting coarseness.

Returning `null` is a normal answer, not an error. The branch simply stays unplaced
and shows up in the admin count.

## What to expect afterwards

Once branches have positions, `branches_within_km()` (migration 0026) starts
returning them, `distancesFor()` starts measuring, and "הכי קרוב אליי" stops
explaining itself and starts sorting. Nothing else has to change: the screens were
written against the finished shape and have been waiting for the data.

## Why there is no tile map (Phase H, 2026-10-09)

Phase H of the V2 brief asked for a map. There is not one, and this is the reasoning
rather than an omission.

**A map of this data would be an empty map.** `branches.latitude` is null for every
branch: migration 0026 shipped the columns with no provider configured, deliberately,
because inventing a position is worse than admitting we have none. Nothing would be
drawn on it today.

**It is not a small dependency.** A tile map means an external tile service that sees
every viewer's IP on every pan, a key the owner has to obtain and keep, and a map
library — on an app whose loudest complaint in the audit was that it was slow
(§2: measured TTFB of 2–5 s). That is the same trade Phase Q (3D transitions) is
explicitly gated on, and it fails the gate for the same reason: not until the app is
fast and stable.

**What somebody actually wants from a map here is one sentence:** *which branch near
me has this?* That is answerable from the data we already hold the moment any branch
has a position, and answerable in text today — including the honest answer.

So migration 0039 (`promotion_branches_near`) orders the branch list that already
opens under a deal's "where" line by distance, says how far each one is, and keeps the
branches it cannot place *after* the ones it can rather than dropping them — a branch
we cannot locate is still a branch the deal is at. A town-centre fix is labelled as a
town centre, because "2 km" measured from a city centre is a precision we do not have.

Until a geocoder runs, the sheet says which of the two reasons there are no distances:
*"we do not yet have the branches' locations"* or *"you have not told us where you
are"* — the second being the one a person can do something about.

**What would change the decision.** Coordinates existing (run
`scripts/ingest/geocode.mjs --target staging --apply`), plus a decision by the owner
about a tile provider, taken knowing it is a third party watching every viewer. At
that point a map is an additive route that can lazy-load its library, and the SQL it
needs — `km_between`, `branches_within_km`, `promotion_branches_near` — is already
here and tested.
