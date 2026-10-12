# israel-geolocation 1.0.1 — where this file came from, and what is wrong with it

`locations.json` is the data file from the npm package
[`israel-geolocation@1.0.1`](https://www.npmjs.com/package/israel-geolocation)
(MIT, published 2025-12-14, repository `github.com/akivaschiff/israel-geolocation`),
copied here unmodified so that regenerating `src/data/israel-cities.ts` is
reproducible and auditable without a network or a runtime dependency.

**1,264 settlements**, each with a Hebrew name, an English name, a latitude and a
longitude, and an `id` that is the CBS settlement symbol (סמל יישוב) — verified:
3000 Jerusalem, 5000 Tel Aviv-Yafo, 4000 Haifa, 9000 Be'er Sheva, 8300 Rishon LeZion.

Its own stated sources: the official settlement list from data.gov.il, 935
coordinates from **OpenStreetMap** (ODbL — OSM contributors are credited in
`src/data/israel-cities.ts` for that reason) and 331 from Google's geocoding API.

## What is wrong with it, measured here

The upstream package did not validate its geocoding results. Checked on import
(`scripts/build-settlements.mjs`, which refuses each of these):

| | rows |
|---|---|
| all sitting on one point, 31.0461/34.8516 — a geocoder's fallback, not a place | 85 |
| four military camps on Jerusalem's exact point | 4 |
| three settlements far apart sharing one point | 3 |
| **עטרת, placed in Los Angeles** (34.0551, −118.3892) | 1 |

That last one is the whole argument for the gate: a coordinate that is merely
*wrong* looks exactly like a coordinate that is right, and nothing downstream can
tell them apart. 1,171 rows survive it.

Cross-checked against the 90 towns this project had compiled independently by
hand: **median disagreement 0.35 km**. Where the two disagree by more than 2 km
the hand-compiled value wins, and every such case turned out to be one of the
fallback points above.
