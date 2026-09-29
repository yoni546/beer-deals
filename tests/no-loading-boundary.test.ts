import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Route-level `loading.tsx` files stall client-side navigation in production builds of this
 * app (Next.js 15.5.26). The loading state is <NavigationProgress /> instead. Full story and
 * how to re-test after an upgrade: docs/LESSONS.md.
 */
const APP = join(import.meta.dirname, "..", "src", "app");

function find(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return find(path);
    return /^loading\.(tsx|ts|jsx|js)$/.test(name) ? [relative(APP, path)] : [];
  });
}

describe("loading state", () => {
  it("uses the top progress bar, not route-level loading.tsx files (docs/LESSONS.md)", () => {
    expect(find(APP)).toEqual([]);
  });
});
