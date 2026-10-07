/**
 * Writes the small bottle for every photo already on record.
 *
 * prepare-bottle.mjs writes both sizes from now on; this is the one-off (and
 * re-runnable) pass over the 27 photos that predate the thumbnail tier. It reads
 * the full asset and rescales it — it never touches the original and never goes
 * near the source photo, so no provenance question arises: these are the same
 * approved pixels at a smaller size.
 *
 *   node scripts/make-bottle-thumbs.mjs          # write any that are missing
 *   node scripts/make-bottle-thumbs.mjs --force  # rewrite them all
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeThumb, THUMB_HEIGHT } from "./lib/bottle-thumb.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--force");

const manifestPath = join(ROOT, "src/design/bottle-photos.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

let written = 0;
let full = 0;
let small = 0;

for (const [slug, entry] of Object.entries(manifest)) {
  const fullPath = join(ROOT, "public", entry.src);
  if (!existsSync(fullPath)) {
    console.error(`! ${slug}: ${entry.src} is not on disk`);
    process.exitCode = 1;
    continue;
  }
  const bytes = readFileSync(fullPath);
  full += bytes.length;

  const already = entry.thumb && existsSync(join(ROOT, "public", entry.thumb.src));
  if (already && !force) {
    small += readFileSync(join(ROOT, "public", entry.thumb.src)).length;
    continue;
  }

  const thumb = await writeThumb(ROOT, slug, bytes);
  manifest[slug] = { ...entry, thumb: { src: thumb.src, width: thumb.width, height: thumb.height } };
  // Keep the manifest's own key order: thumb sits beside width/height, not at the end.
  manifest[slug] = Object.fromEntries(
    Object.entries(manifest[slug]).sort(([a], [b]) => {
      const order = ["src", "width", "height", "thumb"];
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
    }),
  );
  small += thumb.bytes;
  written += 1;
  console.log(`${slug}: ${thumb.width}×${thumb.height}, ${(thumb.bytes / 1024).toFixed(1)} KB`);
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(
  `\n${written} written, ${Object.keys(manifest).length} on record at ${THUMB_HEIGHT}px.` +
    ` Full ${kb(full)} -> thumbs ${kb(small)} (${(100 - (small / full) * 100).toFixed(0)}% smaller).`,
);
