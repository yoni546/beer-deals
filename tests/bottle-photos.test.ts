import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { cutout } from "../scripts/lib/bottle-cutout.mjs";

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
      expect(run("goldstar")).toContain("--source is required");
      expect(run("goldstar", "--source", "x", "--license", "y")).toContain("--approved-by is required");
      expect(run("somersby", "--source", "x", "--license", "y", "--approved-by", "z")).toContain("has no identity");
      // Nothing was written by the refused runs.
      expect(JSON.parse(readFileSync("src/design/bottle-photos.json", "utf8"))).toEqual({});
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
