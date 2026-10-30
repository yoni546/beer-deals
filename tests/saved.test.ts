import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SAVED_MAX, parseSaved, serializeSaved, toggleSaved } from "@/lib/saved";

/**
 * Saved deals (0.41.0). Only keys are kept, on the device; /saved reads the live feed.
 */
describe("saved deals", () => {
  it("round-trips keys through the cookie value", () => {
    const keys = ["obs:12", "deal:4f1c-aa", "grp:7"];
    expect(parseSaved(encodeURIComponent(serializeSaved(keys)))).toEqual(keys);
  });

  it("ignores anything that is not an offer key", () => {
    expect(parseSaved("obs:1|<script>|deal:|grp:2|obs:1")).toEqual(["obs:1", "grp:2"]);
    expect(parseSaved(undefined)).toEqual([]);
    expect(parseSaved("%E0%A4%A")).toEqual([]);
  });

  it("toggles, newest last, and keeps at most SAVED_MAX", () => {
    expect(toggleSaved(["obs:1"], "obs:2")).toEqual(["obs:1", "obs:2"]);
    expect(toggleSaved(["obs:1", "obs:2"], "obs:1")).toEqual(["obs:2"]);
    const many = Array.from({ length: SAVED_MAX + 5 }, (_, i) => `obs:${i}`);
    const kept = parseSaved(serializeSaved(many));
    expect(kept).toHaveLength(SAVED_MAX);
    expect(kept.at(-1)).toBe(`obs:${SAVED_MAX + 4}`);
  });

  it("never stores a price: /saved reads every line from the live feed", () => {
    const page = readFileSync("src/app/saved/page.tsx", "utf8");
    expect(page).toContain("getOffersByKeys");
    const lib = readFileSync("src/lib/saved.ts", "utf8");
    expect(lib).not.toMatch(/agorot/);
  });
});
