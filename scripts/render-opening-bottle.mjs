#!/usr/bin/env node
/**
 * Renders the unlabelled bottle onboarding opens with (scripts/render-opening-bottle.py, Blender + Cycles)
 * and prepares it for the app: cropped to the bottle, WebP, with its crown cap as a separate piece so the
 * cap can come off. Writes public/onboarding/{bottle,cap}.webp and src/design/opening-bottle.json.
 *
 *   node scripts/render-opening-bottle.mjs [samples]
 *
 * Needs Blender 4.2 or newer: on the PATH, at its default Windows location, or named in BLENDER.
 * The render is ours — built from numbers in the script, no model file, no texture, no brand — so it
 * needs no provenance record; re-run this to change it, never edit the images by hand.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HEIGHT = 1200;

function findBlender() {
  if (process.env.BLENDER) return process.env.BLENDER;
  const home = "C:/Program Files/Blender Foundation";
  if (existsSync(home)) {
    const newest = readdirSync(home).sort().reverse().find((dir) => existsSync(join(home, dir, "blender.exe")));
    if (newest) return join(home, newest, "blender.exe");
  }
  return "blender";
}

/** The box of everything that is not transparent. */
async function inked(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let [left, top, right, bottom] = [info.width, info.height, -1, -1];
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] < 8) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

const dir = mkdtempSync(join(tmpdir(), "opening-bottle-"));
try {
  execFileSync(findBlender(), ["-b", "-P", join(ROOT, "scripts", "render-opening-bottle.py"), "--", dir, process.argv[2] ?? "320"], { stdio: ["ignore", "ignore", "inherit"] });
  const [bottle, cap] = [join(dir, "bottle.png"), join(dir, "cap.png")];
  const [b, c] = [await inked(bottle), await inked(cap)];
  // One frame holds both: the bottle, and the cap standing on it.
  const frame = {
    left: Math.min(b.left, c.left),
    top: Math.min(b.top, c.top),
    width: Math.max(b.left + b.width, c.left + c.width) - Math.min(b.left, c.left),
    height: Math.max(b.top + b.height, c.top + c.height) - Math.min(b.top, c.top),
  };
  const out = join(ROOT, "public", "onboarding");
  mkdirSync(out, { recursive: true });
  const webp = { quality: 88, alphaQuality: 92 };
  const bottleOut = await sharp(bottle).extract(frame).resize({ height: HEIGHT }).webp(webp).toFile(join(out, "bottle.webp"));
  const scale = HEIGHT / frame.height;
  const capOut = await sharp(cap).extract(c).resize({ height: Math.round(c.height * scale) }).webp(webp).toFile(join(out, "cap.webp"));

  const round = (n) => Math.round(n * 10000) / 10000;
  const manifest = {
    bottle: { src: "/onboarding/bottle.webp", width: bottleOut.width, height: bottleOut.height },
    // Where the cap sits on the bottle's frame, as fractions of the frame.
    cap: {
      src: "/onboarding/cap.webp",
      left: round((c.left - frame.left) / frame.width),
      top: round((c.top - frame.top) / frame.height),
      width: round(c.width / frame.width),
    },
  };
  writeFileSync(join(ROOT, "src", "design", "opening-bottle.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`bottle ${bottleOut.width}×${bottleOut.height}, ${(bottleOut.size / 1024).toFixed(0)} KB · cap ${capOut.width}×${capOut.height}, ${(capOut.size / 1024).toFixed(0)} KB`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
