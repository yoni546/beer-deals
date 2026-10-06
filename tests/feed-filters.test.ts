import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The feeds are partitioned by store and SKU: filtering by store_id or sku_id reaches the base tables, while
 * filtering by a slug or by beer_id makes Postgres compute the WHOLE feed first (production, 2026-10-06:
 * 1.2–1.4 s instead of 0.2–0.3 s). src/lib/offers.ts must keep to the fast forms.
 */
const src = readFileSync(join(__dirname, "..", "src/lib/offers.ts"), "utf8");

describe("feed reads use the partition keys", () => {
  it("never filters a feed by store_slug or beer_slug equality", () => {
    expect(src).not.toMatch(/\.eq\("(store|beer)_slug"/);
  });

  it("filters a chain by store_id and a beer by its SKU ids (legacy deals by beer, where the view is tiny)", () => {
    expect(src).toContain('query.eq("store_id", storeId)');
    expect(src).toContain('base().in("sku_id", skuIds)');
    expect(src).toContain('base().eq("origin", "legacy").in("beer_id", beerIds)');
    expect(src).toContain('query = query.in("sku_id", skuIds)');
    expect(src).toContain('query = query.eq("store_id", store.id)');
  });

  it("caches only the whole-feed reads that are the same for everyone, briefly, and admin actions clear them", () => {
    expect(src).toMatch(/const FEEDS_TTL_SECONDS = 300;/);
    for (const key of ['"top-pack-offers"', '"listing"', '"freshness"']) expect(src).toContain(`cachedFeed(${key}`);
    const admin = readFileSync(join(__dirname, "..", "src/lib/actions/admin.ts"), "utf8");
    expect(admin).toMatch(/function revalidateAdmin\(\) \{[\s\S]*?revalidateTag\(FEEDS_TAG\)/);
  });
});
