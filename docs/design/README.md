# Design snapshots (Phase D, release 0.4.0)

Captured from the local fake backend with the invented dev catalogue (`supabase/seed/dev-catalog.sql`),
so every price below is sample data. The system is described in [`DESIGN.md`](../../DESIGN.md);
the audit that led to it is [`docs/PRODUCT-AUDIT-2026-09-29.md`](../PRODUCT-AUDIT-2026-09-29.md) §10–14.

| File | What it shows |
| --- | --- |
| `home-390-light.png` | Home at 390×844: the four beers as keys, the headline deal as the receipt total, sort and pack chips, the first strips. Heineken is beer #1, so the counter is Heineken's green. |
| `home-430-dark-guinness.png` | Home at 430×932, dark, Guinness as beer #1: same layout, a near-black counter with a brown accent. |
| `beer-goldstar-390-light.png` | One beer, every pack on its own strip, chains inside; deals and regular prices are separate views. |
| `beer-goldstar-430-dark-guinness.png` | The same page in dark. |
| `store-rami-levy-390-light.png` | One chain, "my beers" on: all four in the person's order, and a plain "no deal here" for the one that has none. |
| `beers-390-light.png` | The searchable beer list, favourites first and numbered. |
| `settings-390-light.png` | Settings: name and ordering of the four beers, notifications, look. |
| `onboarding-ranking-390-light.png` | Onboarding step 2: tapping the first beer has already repainted the page in its colours. |

Regenerate them with the local fake backend and a dev server (see `docs/for-collaborators.md`);
the badge in the corner is the "DEVELOPMENT" marker that never renders in production.

## Favourite #1 is the app (release 0.6.0) — `screens/favourite-one/`

Captured at 390×844 and 430×932 (device scale 1), from the local fake backend. File names are
`<beer as #1>-<width>-<light|dark>-<view>.png`. `_comparison-home-dark.png` / `_comparison-home-light.png` show
Home for Goldstar, Heineken, Carlsberg, Maccabee and Somersby (no identity → the neutral look) side by side.
The full matrix (5 beers × 8 views × 2 sizes × 2 modes, 160 images) was reviewed during the work; these are a
representative subset. The bottles are **drawn stand-ins**, not product photos.
