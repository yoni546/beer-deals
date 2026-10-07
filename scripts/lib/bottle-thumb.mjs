import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The small bottle.
 *
 * Home draws four bottles in a 19×72 CSS box and the Settings list draws them at
 * 52 px, and both were being fed the full hero asset — 26–88 KB each, 862–1600 px
 * tall. A favourites set of weihen + tuborg + corona + heineken meant 292 KiB of
 * imagery to paint four thumbnails. Re-encoding all 27 at this height measured
 * 139 KB in total, down from 1.22 MB.
 *
 * 216 px is 3× the 72 px Home key, so it is exact on a DPR-3 phone and still
 * sharp at the 52 px Settings size.
 *
 * These are the same approved pixels, only scaled: the rule that label art is
 * never redrawn or altered is untouched, and the provenance recorded for the full
 * photo covers this one.
 */
export const THUMB_HEIGHT = 216;

/** Writes `<slug>@216.webp` beside the full photo and returns its manifest entry. */
export async function writeThumb(root, slug, fullBytes) {
  const out = await sharp(fullBytes)
    .resize({ height: THUMB_HEIGHT, withoutEnlargement: true })
    .webp({ quality: 82, alphaQuality: 90 })
    .toBuffer({ resolveWithObject: true });

  writeFileSync(join(root, "public/bottles", `${slug}@${THUMB_HEIGHT}.webp`), out.data);

  return {
    src: `/bottles/${slug}@${THUMB_HEIGHT}.webp`,
    width: out.info.width,
    height: out.info.height,
    bytes: out.data.length,
  };
}
