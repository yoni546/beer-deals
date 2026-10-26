import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

/**
 * The map screen (§5–§9 of the 2026-10-25 brief).
 *
 * These hold the three promises that are easy to lose later and expensive to
 * notice: that the library stays off every other screen, that the map never
 * invents a position, and that the tile provider is named where a reader will
 * find it. None of them is visible in a screenshot of a working map.
 */
describe("the map", () => {
  const map = read("src", "components", "map", "DealsMap.tsx");
  const screen = read("src", "components", "map", "MapScreen.tsx");
  const page = read("src", "app", "map", "page.tsx");

  it("loads Leaflet only on the map screen, and never on the server", () => {
    // The brief: do not load the map library on Home if it is not needed (§9).
    expect(screen).toMatch(/dynamic\(\(\) => import\("@\/components\/map\/DealsMap"\)/);
    expect(screen).toMatch(/ssr:\s*false/);

    // Nothing else may reach for it. A static import anywhere else puts it in that
    // route's bundle, which is exactly the regression this test exists to catch.
    const offenders = ["src/app", "src/components", "src/lib"].flatMap((dir) => files(join(ROOT, dir)))
      .filter((file) => !file.includes(join("components", "map")))
      .filter((file) => /from "leaflet"|require\("leaflet"\)|import "leaflet/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
  });

  it("asks the database for a point's deals, and does not filter them itself", () => {
    // The radius and the "no point means no rows" rule live in SQL (0057), where a
    // caller cannot forget them. The screen must not grow its own copy.
    expect(read("src", "lib", "map.ts")).toMatch(/rpc\("offers_near"/);
    expect(page).not.toMatch(/km_between|filter\(.*radius/i);
  });

  it("says when a pin is only a town centre, rather than letting it look exact", () => {
    expect(map).toContain("מיקום משוער");
    expect(page).toContain("מרכז היישוב");
  });

  it("can be reached by anyone, from one place", () => {
    // A screen nothing links to is not shipped. It is deliberately NOT a fifth tab:
    // a map is one way of reading the answer Home already gives, not one of the four
    // things this app is.
    const home = read("src", "app", "page.tsx");
    expect(home).toMatch(/href="\/map"/);
    // 2026-10-25: NOT behind a location. The map used to appear only for somebody
    // we could already place, which made it a reward for filling in a profile.
    expect(home).not.toMatch(/distances\.available && [\s\S]{0,80}href="\/map"/);
    const page = read("src", "app", "map", "page.tsx");
    expect(page).toMatch(/const chosen = lat !== null/);
    expect(page).not.toMatch(/EmptyState/);

    // And nowhere else, so it cannot quietly become navigation.
    const everywhere = ["src/app", "src/components"].flatMap((dir) => tsx(join(ROOT, dir)))
      .filter((file) => !file.includes(join("app", "map")) && !file.includes(join("components", "map")))
      .filter((file) => /href="\/map"/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(ROOT.length + 1));
    expect(everywhere).toEqual([join("src", "app", "page.tsx")]);
  });

  it("names the tile provider in the attribution, on the map", () => {
    expect(map).toMatch(/attribution:/);
    expect(map).toContain("openstreetmap.org/copyright");
  });
});

const tsx = (dir: string) => files(dir);

function files(dir: string): string[] {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
