#!/usr/bin/env node
/**
 * Fetches the real product photo chosen for each beer and runs it through scripts/prepare-bottle.mjs
 * (white background removed, cropped, ≤ 1600 px, WebP, provenance recorded in
 * src/design/bottle-photos.json). Reproducible: the list below IS the record of where every bottle came
 * from.
 *
 *   node scripts/fetch-bottles.mjs [slug …]
 *
 * Sources, in order of preference:
 *   1. Wikimedia Commons files under a free licence (CC0 / public domain / CC BY / CC BY-SA) — the licence
 *      and author are recorded, and must be credited (the app's "about" credits list them);
 *   2. the retailer's own pack shot, found by the product's barcode (Rami Levy's online catalogue): the
 *      current Israeli packaging on a plain white background. These are NOT under a free licence; they
 *      are used with the owner's decision of 2026-09-29 ("it is acceptable to obtain product photography
 *      from public internet sources"), with the source recorded. Replace any of them with a licensed
 *      or brand-supplied photo by editing this list and re-running.
 *
 * Nothing is redrawn or recoloured: the photo's own pixels are kept (prepare-bottle.mjs only removes the
 * background connected to the image border).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UA = "beer-deals/1.0 (+https://github.com/yoni546/beer-deals)";
const APPROVAL = "owner decision 2026-09-29 (product photography from public sources, provenance recorded)";
const RETAILER = "Retailer pack shot — not under a free licence; brand packaging is the copyright of its owner";
const rami = (barcode) => ({
  url: `https://img.rami-levy.co.il/product/${barcode}/large.jpg`,
  sourceName: "Rami Levy online catalogue (img.rami-levy.co.il)",
  license: RETAILER,
  barcode,
});
const commons = (file, license, author, extra = {}) => ({
  url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=1600`,
  page: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, "_"))}`,
  sourceName: "Wikimedia Commons",
  license: `${license}, ${author}`,
  ...extra,
});

/** One photo per beer: a single bottle of the beer's main product, as sold in Israel. */
export const BOTTLES = {
  goldstar: rami("7290006764072"),
  heineken: rami("7290010237890"),
  carlsberg: rami("7290002871361"),
  maccabee: rami("7290005896439"),
  tuborg: rami("7290001975015"),
  "tuborg-red": rami("7290002871248"),
  stella: rami("7290019398288"),
  guinness: rami("5000213000359"),
  budweiser: rami("5410228267508"),
  becks: rami("42149996"),
  leffe: rami("7290019398271"),
  paulaner: rami("4066600611028"),
  weihen: rami("4105120623941"),
  erdinger: rami("4002103250487"),
  malka: rami("7290012921025"),
  shapiro: rami("7290014056015"),
  alexander: rami("7290013430083"),
  negev: rami("7290013276124"),
  // 0.8.0 (migration 0016)
  eagle: rami("7290006764096"),
  staropramen: rami("8593868000302"),
  chouffe: rami("5410769100081"),
  kasteel: rami("5411081003654"), // Kasteel Rouge, the one most chains carry
  hoegaarden: rami("7290019398295"),
  franziskaner: rami("4072700003649"),
  "blue-moon": rami("5010038454831"),
  benediktiner: rami("4052197000017"),
  corona: commons("Corona Extra beer bottle (2019).png", "CC BY-SA 4.0", "Bruce The Deus"),
  // 0.40.x (owner's list 2026-10-29): the catalogue now has single-bottle barcodes for these.
  krombacher: rami("4008287762020"), // Krombacher Weizen 500 ml, the bottle the feeds list
  kronenbourg: { ...rami("851621000043"), tolerance: 8 }, // 1664 Blanc 330 ml, Israeli label; white cap and label on white, so a tight cut
  // desperados: no usable photo yet — the free ones are shot against walls and tables (the background
  //   cannot be removed without redrawing), and no Israeli retailer's catalogue lists it. Drawn stand-in.
  // bazelet: no barcode in any feed and no free photo. Drawn stand-in.
  // miller: the retailer catalogue shows only the can (8593868006847). Drawn stand-in.
  // duvel: a photo exists (5411681014005) but the beer has no identity in src/design/themes.ts yet.
  // (krombacher and kronenbourg were here until 2026-10-29, when the feeds gave single-bottle barcodes.)
  // estrella: the catalogue has no image for its barcodes (HTTP 403). Drawn stand-in.
  // Tried 2026-10-05 and rejected, so nobody repeats it: Commons "KrombacherPils.jpg" (garden fence),
  //   "Estrella2014.jpg" (a street) and "Desperados original 25cl.jpg" (grey wall and table). None is on a
  //   plain white background, so the cut-out leaves the scenery in.
};

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(BOTTLES);
const dir = mkdtempSync(join(tmpdir(), "bottles-"));
try {
  for (const slug of wanted) {
    const b = BOTTLES[slug];
    if (!b) throw new Error(`no photo chosen for ${slug}`);
    const res = await fetch(b.url, { headers: { "user-agent": UA }, redirect: "follow" });
    if (!res.ok) throw new Error(`${slug}: HTTP ${res.status} for ${b.url}`);
    const file = join(dir, `${slug}.img`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    const args = [
      join(ROOT, "scripts", "prepare-bottle.mjs"), file, slug,
      "--source", b.page ?? b.url,
      "--source-url", b.url,
      "--source-name", b.sourceName,
      "--license", b.license,
      "--approved-by", APPROVAL,
      ...(b.barcode ? ["--barcode", b.barcode] : []),
      ...(b.tolerance ? ["--tolerance", String(b.tolerance)] : []),
      ...(b.crop ? ["--crop", b.crop] : []),
    ];
    process.stdout.write(`${slug.padEnd(11)} `);
    execFileSync(process.execPath, args, { stdio: ["ignore", "inherit", "inherit"], cwd: ROOT });
    await new Promise((ok) => setTimeout(ok, 500));
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
