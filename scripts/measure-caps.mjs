#!/usr/bin/env node
/**
 * Records where each approved bottle photo's crown cap ends (`cap`, a fraction of the height) in
 * src/design/bottle-photos.json. prepare-bottle.mjs does this for a new photo; this re-measures all
 * of them. Reads the files only — no photo is changed.
 *
 *   node scripts/measure-caps.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { capBottom } from "./lib/bottle-cutout.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(ROOT, "src/design/bottle-photos.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

for (const [slug, photo] of Object.entries(manifest)) {
  const { data, info } = await sharp(join(ROOT, "public", photo.src)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cap = capBottom(data, info.width, info.height);
  delete photo.cap;
  if (cap !== null) photo.cap = cap;
  console.log(`${slug.padEnd(14)} ${cap === null ? "no cap found" : `${(cap * 100).toFixed(1)}%`}`);
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
