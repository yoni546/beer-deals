import { describe, expect, it } from "vitest";
import { asUser } from "./helpers/db";
import { inDays, world, type World } from "./helpers/catalog";

/**
 * The Deal Score (migration 0027).
 *
 * The brief asked for a number that means something rather than a badge, so these
 * tests are mostly about what the score REFUSES to say: no trusted reference, no
 * score; a flagged offer, no score; one self-reported signal, no claim of
 * excellence. The arithmetic matters less than the discipline around it.
 */

type Score = { offer_key: string; score: number; band: string; basis: Record<string, unknown> };

// The score is computed FROM the feed, and since 0044 the feed's chain half is a
// table the import fills. So the order here is the import's order: rebuild the
// feed, then score what it says. Scoring first would score the previous rebuild.
const refresh = async (w: World, as?: string) => {
  await w.rebuildFeed();
  return asUser(w.db, as === undefined ? w.admin : as, () =>
    w.db.query<{ n: number }>("select public.refresh_offer_scores() as n"),
  );
};

const scores = async (w: World): Promise<Score[]> =>
  (await w.db.query<Score>("select offer_key, score, band, basis from public.offer_scores order by score desc")).rows;

/** A pack, its chain's usual price, and a promotion on it. */
let packs = 0;
async function shelf(
  w: World,
  opts: { store: string; regular: number; promo?: number; sku?: string; observedAt?: string; validTo?: string | null },
) {
  // A fresh pack each time unless the caller names one: skus has a unique identity on
  // (beer, container, volume, pack), so two calls cannot both invent a 6x330 Goldstar.
  const sku = opts.sku ?? (await w.sku(w.ids.goldstar, "bottle", 330 + packs++, 6));
  await w.source("chain", "chain_feed");
  await w.record({ sku, store: opts.store, kind: "regular", price: opts.regular, source: "chain", observedAt: opts.observedAt ?? inDays(-1) });
  if (opts.promo !== undefined) {
    await w.record({
      sku,
      store: opts.store,
      kind: "promotion",
      price: opts.promo,
      source: "chain",
      promoType: "price_cut",
      validFrom: inDays(-1),
      validTo: opts.validTo === undefined ? inDays(7) : opts.validTo,
      naturalKey: `promo-${opts.store}-${sku}`,
    });
  }
  return sku;
}

describe("what the Deal Score refuses to say", () => {
  it("gives no score at all to an offer with no trusted reference price", async () => {
    const w = await world();
    const sku = await w.sku(w.ids.goldstar, "bottle", 330, 6);
    await w.source("chain", "chain_feed");
    // A promotion with no regular price behind it: offers_feed emits value_pct null.
    await w.record({
      sku, store: w.ids.rami, kind: "promotion", price: 2490, source: "chain",
      promoType: "price_cut", validFrom: inDays(-1), validTo: inDays(7), naturalKey: "lonely",
    });

    await refresh(w);
    // Absent, not zero. A zero would be a claim; absence is the truth.
    expect(await scores(w)).toHaveLength(0);
  });

  it("gives no score to an offer flagged for review", async () => {
    const w = await world();
    // A 90% "discount" trips needs_review in 0017 and value_pct is withheld.
    await shelf(w, { store: w.ids.rami, regular: 10000, promo: 1000 });
    await refresh(w);
    expect(await scores(w)).toHaveLength(0);
  });

  it("will not call a deal exceptional on the chain's own word alone", async () => {
    const w = await world();
    // A single chain: no other chain to form a market median, and no history.
    await shelf(w, { store: w.ids.rami, regular: 4000, promo: 2000 }); // 50% off
    await refresh(w);

    const [row] = await scores(w);
    expect(row.score).toBeLessThanOrEqual(80);
    expect((row.basis as { capped: boolean }).capped).toBe(true);
    expect(row.band).not.toBe("amazing");
  });
});

describe("what it does say", () => {
  it("scores a deeper discount higher than a shallow one", async () => {
    const w = await world();
    const deep = await shelf(w, { store: w.ids.rami, regular: 4000, promo: 2400 }); // 40% off
    const shallow = await shelf(w, { store: w.ids.shufersal, regular: 4000, promo: 3600 }); // 10% off
    expect(deep).not.toBe(shallow);

    await refresh(w);
    const rows = await scores(w);
    expect(rows).toHaveLength(2);
    expect(rows[0].score).toBeGreaterThan(rows[1].score);
  });

  it("weighs the other chains' prices above the chain's own claim", async () => {
    const w = await world();
    const sku = await w.sku(w.ids.goldstar, "bottle", 330, 6);
    await w.source("chain", "chain_feed");

    // Two other chains sell it for about 3000. Our chain's shelf price is inflated to
    // 6000 and "discounted" to 2900 -- a 52% discount by its own claim, but only a few
    // per cent better than everyone else.
    for (const store of [w.ids.victory, w.ids.yochananof]) {
      await w.record({ sku, store, kind: "regular", price: 3000, source: "chain", observedAt: inDays(-1) });
    }
    await shelf(w, { store: w.ids.rami, regular: 6000, promo: 2900, sku });

    await refresh(w);
    const [row] = await scores(w);
    const basis = row.basis as { chain: { points: number }; market: { points: number } };

    expect(basis.market).toBeDefined();
    // The chain's own number is flattering; the market's is not, and it pulls the score down.
    expect(basis.chain.points).toBeGreaterThan(basis.market.points);
    expect(row.score).toBeLessThan(basis.chain.points);
  });

  it("knows when a price is the best this pack has ever been", async () => {
    const w = await world();
    const sku = await w.sku(w.ids.goldstar, "bottle", 330, 6);
    await w.source("chain", "chain_feed");

    // A history of around 4000, then a promotion well below anything seen before.
    for (const [days, price] of [[-170, 4100], [-120, 4000], [-60, 3900], [-30, 4050]] as const) {
      await w.record({ sku, store: w.ids.rami, kind: "regular", price, source: "chain", observedAt: inDays(days) });
    }
    await w.record({ sku, store: w.ids.rami, kind: "regular", price: 4000, source: "chain", observedAt: inDays(-1) });
    await w.record({
      sku, store: w.ids.rami, kind: "promotion", price: 2600, source: "chain",
      promoType: "price_cut", validFrom: inDays(-1), validTo: inDays(7), naturalKey: "best-ever",
    });

    await refresh(w);
    const [row] = await scores(w);
    const basis = row.basis as { history?: { points: number; samples: number } };
    expect(basis.history, "no history component was computed").toBeDefined();
    expect(basis.history!.points).toBe(100); // below everything on record
    expect(basis.history!.samples).toBeGreaterThanOrEqual(4);
  });

  it("is deterministic: the same shelf scores the same twice", async () => {
    const w = await world();
    await shelf(w, { store: w.ids.rami, regular: 4000, promo: 2600 });

    await refresh(w);
    const first = await scores(w);
    await refresh(w);
    const second = await scores(w);
    expect(second.map((r) => r.score)).toEqual(first.map((r) => r.score));
  });

  it("puts every score in a band, and the bands are in order", async () => {
    const w = await world();
    await shelf(w, { store: w.ids.rami, regular: 4000, promo: 2400 });
    await shelf(w, { store: w.ids.shufersal, regular: 4000, promo: 3800 });

    await refresh(w);
    const rows = await scores(w);
    const order = { amazing: 3, very_good: 2, fair: 1, weak: 0 };
    for (const row of rows) {
      expect(["amazing", "very_good", "fair", "weak"]).toContain(row.band);
    }
    // Sorted by score descending, so bands may never climb.
    for (let i = 1; i < rows.length; i++) {
      expect(order[rows[i].band as keyof typeof order]).toBeLessThanOrEqual(order[rows[i - 1].band as keyof typeof order]);
    }
  });

  it("can explain itself: every component it used is on the row", async () => {
    const w = await world();
    await shelf(w, { store: w.ids.rami, regular: 4000, promo: 2600 });
    await refresh(w);

    const [row] = await scores(w);
    const basis = row.basis as { chain: { value_pct: number; points: number; weight: number } };
    expect(basis.chain.weight).toBe(0.25);
    expect(basis.chain.value_pct).toBe(35);
    expect(typeof basis.chain.points).toBe("number");
  });
});

describe("a score is not kept past the deal it describes", () => {
  it("drops the score when the offer is gone", async () => {
    const w = await world();
    await shelf(w, { store: w.ids.rami, regular: 4000, promo: 2600 });
    await refresh(w);
    expect(await scores(w)).toHaveLength(1);

    // Close the promotion: it leaves promotions_current, so it leaves offers_feed.
    await w.db.query("update public.price_observations set status = 'superseded' where kind = 'promotion'");
    await refresh(w);
    expect(await scores(w)).toHaveLength(0);
  });
});

describe("who may recompute it", () => {
  it("refuses a signed-in visitor and the anonymous public", async () => {
    const w = await world();
    await expect(refresh(w, w.visitor)).rejects.toThrow(/admin or service privileges required/);
    await expect(
      asUser(w.db, null, () => w.db.query("select public.refresh_offer_scores()"), "anon"),
    ).rejects.toThrow(/permission denied/);
  });

  it("lets everyone READ the scores: they are part of the public price picture", async () => {
    const w = await world();
    await shelf(w, { store: w.ids.rami, regular: 4000, promo: 2600 });
    await refresh(w);

    const seen = await asUser(w.db, null, () => w.db.query("select score from public.offer_scores"), "anon");
    expect(seen.rows).toHaveLength(1);
  });
});
