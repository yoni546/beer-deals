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

  it("caches the reads that are the same for everyone, briefly, and admin actions clear them", () => {
    // The reader and the cache live in src/lib/feeds.ts, so queries.ts can use them too
    // without importing offers.ts (which imports queries.ts).
    const feeds = readFileSync(join(__dirname, "..", "src/lib/feeds.ts"), "utf8");
    expect(feeds).toMatch(/const FEEDS_TTL_SECONDS = 300;/);
    expect(feeds).toMatch(/persistSession: false/); // cookie-less, or the cache keys per session

    for (const key of ['"top-pack-offers"', '"listing"', '"freshness"', '"skus"']) {
      expect(src).toContain(`cachedFeed(${key}`);
    }
    // The catalogue is the same for everyone too, and used to be re-read on every page load.
    const queries = readFileSync(join(__dirname, "..", "src/lib/queries.ts"), "utf8");
    for (const key of ['"beers"', '"stores"', '"settings"', '"beers-by-slug"', '"stores-by-slug"']) {
      expect(queries).toContain(`cachedFeed(${key}`);
    }
    // No `select("*")` CALL left in the catalogue reads: beers carries theme_* columns nothing reads.
    expect(queries).not.toMatch(/\.select\("\*"\)/);

    const admin = readFileSync(join(__dirname, "..", "src/lib/actions/admin.ts"), "utf8");
    expect(admin).toMatch(/function revalidateAdmin\(\) \{[\s\S]*?revalidateTag\(FEEDS_TAG\)/);
  });

  it("looks a beer or chain up by slug across every row, not only the ones people may choose", () => {
    // getBeers() is the list to choose from (active, in-scope). A page for a deactivated
    // beer, or for a cider, must still render rather than 404, so the slug index is separate.
    const queries = readFileSync(join(__dirname, "..", "src/lib/queries.ts"), "utf8");
    expect(queries).toMatch(/cachedFeed\("beers-by-slug"[\s\S]*?from\("beers"\)\.select\(BEER_COLUMNS\)/);
    expect(queries).not.toMatch(/getBeerBySlug[\s\S]{0,200}await getBeers\(\)/);
  });
});
