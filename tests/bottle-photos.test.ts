import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { capBottom, cutout } from "../scripts/lib/bottle-cutout.mjs";
import photos from "@/design/bottle-photos.json";

/**
 * The path for a real, licensed bottle photo: the white background goes, the bottle stays exactly
 * as photographed (including white label areas inside it), and a photo on record replaces the
 * drawn bottle for that beer — through the same readability filter.
 */

/** A synthetic "product photo": white background, a brown bottle, a white label inside it. */
async function productPhoto() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="600">
    <rect width="300" height="600" fill="#ffffff"/>
    <rect x="100" y="80" width="100" height="480" rx="30" fill="#5a3010"/>
    <rect x="110" y="300" width="80" height="120" fill="#ffffff"/>
  </svg>`;
  return sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

const alphaAt = (data: Uint8Array, width: number, x: number, y: number) => data[(y * width + x) * 4 + 3];

describe("cutting a bottle out of a white product photo", () => {
  it("removes the white background connected to the edges and keeps the bottle opaque", async () => {
    const { data, info } = await productPhoto();
    const { data: out, box } = cutout(data, info.width, info.height);
    expect(alphaAt(out, info.width, 0, 0)).toBe(0); // corner: background
    expect(alphaAt(out, info.width, 50, 300)).toBe(0); // beside the bottle
    expect(alphaAt(out, info.width, 150, 200)).toBe(255); // glass
    expect(box).toMatchObject({ left: 100, top: 80, width: 100, height: 480 });
  });

  it("never removes a white label enclosed by the bottle — the brand's artwork is not touched", async () => {
    const { data, info } = await productPhoto();
    const { data: out } = cutout(data, info.width, info.height);
    expect(alphaAt(out, info.width, 150, 360)).toBe(255);
    // …and its colour is exactly what was photographed.
    const o = (360 * info.width + 150) * 4;
    expect([out[o], out[o + 1], out[o + 2]]).toEqual([255, 255, 255]);
  });

  it("reports an all-white image instead of producing an empty file", () => {
    const white = new Uint8Array(10 * 10 * 4).fill(255);
    expect(cutout(white, 10, 10).box).toBeNull();
  });
});

describe("the prepare script", () => {
  it("refuses a photo without provenance, and a beer without an identity", async () => {
    const { execFileSync } = await import("node:child_process");
    const dir = mkdtempSync(join(tmpdir(), "bottle-"));
    try {
      const photo = join(dir, "p.png");
      writeFileSync(photo, await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).png().toBuffer());
      const run = (...args: string[]) => {
        try {
          execFileSync(process.execPath, ["scripts/prepare-bottle.mjs", photo, ...args], { stdio: "pipe" });
          return "ok";
        } catch (error) {
          return String((error as { stderr?: Buffer }).stderr);
        }
      };
      const before = readFileSync("src/design/bottle-photos.json", "utf8");
      expect(run("goldstar")).toContain("--source is required");
      expect(run("goldstar", "--source", "x", "--license", "y")).toContain("--approved-by is required");
      expect(run("somersby", "--source", "x", "--license", "y", "--approved-by", "z")).toContain("has no identity");
      // Nothing was written by the refused runs.
      expect(readFileSync("src/design/bottle-photos.json", "utf8")).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a photo on record replaces the drawn bottle for that beer", () => {
  it("uses the photo, keeps the provenance, and keeps the readability filter", async () => {
    vi.resetModules();
    vi.doMock("@/design/bottle-photos.json", () => ({
      default: {
        goldstar: { src: "/bottles/goldstar.webp", width: 400, height: 1600, source: "brand press kit", license: "written permission", approvedBy: "owner", addedOn: "2026-09-29" },
      },
    }));
    const { getThemeForBeer } = await import("@/design/themes");
    const goldstar = getThemeForBeer("goldstar");
    expect(goldstar.background).toMatchObject({ kind: "photo", photo: { src: "/bottles/goldstar.webp", license: "written permission" } });
    expect(goldstar.modes.dark.bottleTone.hi).toBeGreaterThan(goldstar.modes.dark.bottleTone.lo);
    expect(getThemeForBeer("heineken").background.kind).toBe("drawn"); // no photo on record → drawn
    vi.doUnmock("@/design/bottle-photos.json");
  });
});

/**
 * Beers that have an identity but no photograph, each for a reason recorded at
 * scripts/fetch-bottles.mjs:74-83. They render a drawn stand-in, which works but
 * reads as a second-class citizen beside 27 photographs.
 *
 * This list exists so the set can only ever SHRINK deliberately. Nothing used to
 * assert photo coverage at all: the floor was ">= 19 entries" while 27 existed, so
 * eight photos and their manifest entries could be deleted together and CI stayed
 * green. Adding a photo means removing a line here.
 */
const PHOTOLESS = ["bazelet", "desperados", "estrella", "krombacher", "kronenbourg", "miller"];

describe("the real bottle photos on record", () => {
  it("every one has a file, its provenance, and belongs to a beer with an identity", async () => {
    const { existsSync } = await import("node:fs");
    const manifest = JSON.parse(readFileSync("src/design/bottle-photos.json", "utf8")) as Record<string, Record<string, string | number>>;
    const themes = readFileSync("src/design/themes.ts", "utf8");
    expect(Object.keys(manifest).length).toBeGreaterThanOrEqual(19);
    for (const [slug, photo] of Object.entries(manifest)) {
      expect(themes, slug).toContain(`beer("${slug}"`);
      expect(existsSync(join("public", String(photo.src))), slug).toBe(true);
      for (const key of ["source", "sourceUrl", "sourceName", "license", "approvedBy", "addedOn"]) expect(photo[key], `${slug}.${key}`).toBeTruthy();
      // Small enough to load fast as a background (only favourite #1's is ever requested).
      expect(Number(photo.height), slug).toBeLessThanOrEqual(1600);
    }
  });

  it("covers every beer with an identity except the ones we have deliberately not found", () => {
    const manifest = JSON.parse(readFileSync("src/design/bottle-photos.json", "utf8")) as Record<string, unknown>;
    const themes = readFileSync("src/design/themes.ts", "utf8");
    const identities = [...themes.matchAll(/\bbeer\("([a-z0-9-]+)"/g)].map((m) => m[1]);
    expect(identities.length).toBeGreaterThan(20);

    const missing = identities.filter((slug) => !(slug in manifest)).sort();
    expect(missing).toEqual([...PHOTOLESS].sort());
  });

  it("records the real pixel size of every file, so a layout can be reserved from it", async () => {
    const manifest = JSON.parse(readFileSync("src/design/bottle-photos.json", "utf8")) as Record<
      string,
      { src: string; width: number; height: number; thumb?: { src: string; width: number; height: number } }
    >;
    for (const [slug, photo] of Object.entries(manifest)) {
      const real = await sharp(join("public", photo.src)).metadata();
      expect({ slug, w: real.width, h: real.height }).toEqual({ slug, w: photo.width, h: photo.height });
      if (photo.thumb) {
        const thumb = await sharp(join("public", photo.thumb.src)).metadata();
        expect({ slug, w: thumb.width, h: thumb.height }).toEqual({ slug, w: photo.thumb.width, h: photo.thumb.height });
      }
    }
  });

  it("has a small bottle for lists, and it really is small", async () => {
    const { statSync } = await import("node:fs");
    const manifest = JSON.parse(readFileSync("src/design/bottle-photos.json", "utf8")) as Record<
      string,
      { src: string; thumb?: { src: string; height: number } }
    >;
    for (const [slug, photo] of Object.entries(manifest)) {
      expect(photo.thumb, `${slug} has no thumbnail — run node scripts/make-bottle-thumbs.mjs`).toBeTruthy();
      expect(photo.thumb!.height, slug).toBe(216); // 3x the 72px Home key
      // A budget, not a measurement: today's largest is ~5 KB. Home draws four at once.
      expect(statSync(join("public", photo.thumb!.src)).size, slug).toBeLessThan(12_000);
      // And the hero asset keeps its own ceiling.
      expect(statSync(join("public", photo.src)).size, slug).toBeLessThan(120_000);
    }
  });

  it("asks for the small bottle at list sizes and the full one behind the counter", () => {
    const bottle = readFileSync("src/components/ui/Bottle.tsx", "utf8");
    expect(bottle).toMatch(/height <= 96 && photo\.thumb \? photo\.thumb : photo/);
    // The backdrop is favourite #1's hero bottle and must never take the thumbnail.
    expect(bottle).toMatch(/BottleBackdrop[\s\S]*?photo\.src/);
  });
});

describe("finding the crown cap in a cut-out bottle (onboarding takes the real cap off)", () => {
  /** A silhouette: a cap `capW` wide and 30 px tall over a neck 60 px wide, on a 200 × 1000 canvas. */
  const silhouette = (capW: number, capH = 30) => {
    const [width, height] = [200, 1000];
    const data = new Uint8Array(width * height * 4);
    const fill = (x0: number, x1: number, y0: number, y1: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data[(y * width + x) * 4 + 3] = 255;
    };
    fill(100 - capW / 2, 100 + capW / 2, 0, capH);
    fill(70, 130, capH, height);
    return capBottom(data, width, height);
  };

  it("finds where a crown — wider than the glass under it — ends", () => {
    expect(silhouette(80)).toBeCloseTo(0.03, 2);
  });

  it("finds nothing on a neck with no crown, or one wrapped in foil far down the neck", () => {
    expect(silhouette(60)).toBeNull(); // no wider than the neck
    expect(silhouette(80, 70)).toBeNull(); // 7% of the height: foil, not a cap
  });

  it("has a plausible cap on record for every photo that has one", () => {
    for (const [slug, photo] of Object.entries(photos as Record<string, { cap?: number }>)) {
      if (photo.cap === undefined) continue;
      expect(photo.cap, slug).toBeGreaterThanOrEqual(0.012);
      expect(photo.cap, slug).toBeLessThanOrEqual(0.055);
    }
    expect((photos as Record<string, { cap?: number }>).goldstar.cap).toBeCloseTo(0.028, 3);
  });
});
