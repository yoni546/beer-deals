#!/usr/bin/env node
/**
 * Prepares an APPROVED bottle photo for the app's background.
 *
 *   node scripts/prepare-bottle.mjs <photo> <beer-slug> \
 *     --source "where it came from (URL, brand press kit, own photo…)" \
 *     --license "the terms under which we may use it" \
 *     --approved-by "who approved it"  *     [--source-url <exact file URL>] [--source-name "Rami Levy online catalogue"] [--barcode <GTIN>]  *     [--crop left,top,width,height]   (to keep only the bottle when the photo also shows a glass)
 *
 * What it does: removes a white/near-white background (edge flood fill; the bottle's own pixels,
 * including white label areas inside it, are kept exactly), crops to the bottle, scales to at most
 * 1600 px tall, writes public/bottles/<slug>.webp, and records the provenance in
 * src/design/bottle-photos.json. From then on getThemeForBeer(<slug>) uses the photo instead of the
 * drawn bottle — through the same tone filter, so readability is still guaranteed.
 *
 * It refuses to run without all three provenance fields. Do not use photos whose licence you have
 * not checked; do not use this to alter, redraw or "improve" a brand's artwork.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { capBottom, cutout } from "./lib/bottle-cutout.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? "" : (args[i + 1] ?? "").trim();
};
const [input, slug] = args.filter((arg, i) => !arg.startsWith("--") && !args[i - 1]?.startsWith("--"));
const provenance = { source: flag("source"), license: flag("license"), approvedBy: flag("approved-by") };
const extra = Object.fromEntries(
  [["sourceUrl", flag("source-url")], ["sourceName", flag("source-name")], ["barcode", flag("barcode")]].filter(([, v]) => v),
);
const crop = flag("crop") ? flag("crop").split(",").map(Number) : null;
const tolerance = Number(flag("tolerance") || 30);

const fail = (message) => {
  console.error(`prepare-bottle: ${message}`);
  process.exit(1);
};
if (!input || !slug) fail("usage: node scripts/prepare-bottle.mjs <photo> <beer-slug> --source … --license … --approved-by …");
const known = [...readFileSync(join(ROOT, "src/design/themes.ts"), "utf8").matchAll(/^\s*beer\("([a-z0-9-]+)"/gm)].map((m) => m[1]);
if (!known.includes(slug)) fail(`"${slug}" has no identity in src/design/themes.ts (known: ${known.join(", ")})`);
for (const [key, value] of Object.entries(provenance)) if (!value) fail(`--${key === "approvedBy" ? "approved-by" : key} is required: every bottle photo needs its provenance on record`);

let image = sharp(readFileSync(input)).rotate();
if (crop) image = sharp(await image.extract({ left: crop[0], top: crop[1], width: crop[2], height: crop[3] }).toBuffer());
const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { data: cut, box } = cutout(data, info.width, info.height, { tolerance });
if (!box) fail("nothing left after removing the background — is the photo all white?");
const coverage = (box.width * box.height) / (info.width * info.height);

const out = await sharp(Buffer.from(cut), { raw: { width: info.width, height: info.height, channels: 4 } })
  .extract(box)
  .resize({ height: Math.min(1600, box.height), withoutEnlargement: true })
  .webp({ quality: 86, alphaQuality: 90 })
  .toBuffer({ resolveWithObject: true });
const final = await sharp(out.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const cap = capBottom(final.data, final.info.width, final.info.height);

mkdirSync(join(ROOT, "public/bottles"), { recursive: true });
writeFileSync(join(ROOT, "public/bottles", `${slug}.webp`), out.data);

const manifestPath = join(ROOT, "src/design/bottle-photos.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest[slug] = {
  src: `/bottles/${slug}.webp`,
  width: out.info.width,
  height: out.info.height,
  ...provenance,
  ...extra,
  ...(cap === null ? {} : { cap }),
  addedOn: new Date().toISOString().slice(0, 10),
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log(`wrote public/bottles/${slug}.webp (${out.info.width}×${out.info.height}, ${(out.data.length / 1024).toFixed(0)} KB); bottle covers ${(coverage * 100).toFixed(0)}% of the original frame`);
console.log("Check it: the app now shows the photo for this beer. Commit the .webp and the manifest together.");
