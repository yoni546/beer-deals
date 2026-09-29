import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { kindOf, parseFileName } from "../scripts/ingest/lib/files.mjs";
import { checkPrice, classify, inForce, isGtin, israelTime, parsePack, readPromotion, reconcileBarcodes } from "../scripts/ingest/lib/normalize.mjs";
import { discountedPrices, withDiscountedPrices } from "../scripts/ingest/lib/promo-supplement.mjs";

/**
 * The ingestion dry run's normaliser, against REAL rows: tests/fixtures/ingest/<chain>.json are excerpts of
 * the six chains' feeds of 2026-09-29 as parsed by the installed skill (scripts/ingest/make-fixtures.mjs).
 * The rule under test everywhere: decide only what the row states; everything else is reported, never guessed.
 */
type Item = { item_code: string; item_name: string; manufacturer: string; price: number; quantity: string; unit_of_measure: string; is_weighted: boolean };
type Promo = { promotion_id: string; description: string; club_only: boolean; start: string; end: string; items: { item_code: string }[] };
type Fixture = { chain: string; dialect: string; items: Item[]; promotions: Promo[] };

const DIR = join(__dirname, "fixtures", "ingest");
const fixtures: Fixture[] = readdirSync(DIR).map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")));
const all = fixtures.flatMap((f) => f.items.map((it) => ({ ...it, chain: f.chain })));
const find = (chain: string, name: string) => {
  const hit = fixtures.find((f) => f.chain === chain)!.items.find((it) => it.item_name.includes(name));
  if (!hit) throw new Error(`fixture ${chain} has no row named like ${name}`);
  return hit;
};
const item = (name: string, quantity = "1.00", unit = "יחידות", price = 10): Item => ({ item_code: "7290000000000", item_name: name, manufacturer: "", price, quantity, unit_of_measure: unit, is_weighted: false });

describe("real fixtures", () => {
  it("cover six chains, each with beer rows and promotions", () => {
    expect(fixtures.map((f) => f.chain).sort()).toEqual(["carrefour", "osher-ad", "rami-levy", "shufersal", "tiv-taam", "yochananof"]);
    for (const f of fixtures) {
      expect(f.items.filter((it) => classify(it).beer).length, f.chain).toBeGreaterThan(20);
      expect(f.promotions.length, f.chain).toBeGreaterThan(5);
    }
  });
});

describe("what is beer", () => {
  it("finds our beers under the names shelves really use", () => {
    expect(classify(find("carrefour", "גולדסטאר"))).toMatchObject({ verdict: "beer", beer: "goldstar" });
    expect(classify(item("הייניקן בירה פח 500מ"))).toMatchObject({ beer: "heineken" });
    expect(classify(item("בירה מכבי7.9%בק.חוזר500מ"))).toMatchObject({ beer: "maccabee" }); // a digit may touch the name
    expect(classify(item("בירה בדוויזר שישייה"))).toMatchObject({ beer: "budweiser" });
  });

  it("does not read a beer name inside another word, or an ambiguous name without 'בירה'", () => {
    expect(classify(item("שוקולד נסטלה 100 גרם")).verdict).toBe("not_beer"); // נסטלה ⊃ סטלה
    expect(classify(item("תה גינסנג")).verdict).toBe("not_beer"); // גינסנג ⊃ גינס
    expect(classify(item("מכבי שירותי בריאות")).verdict).toBe("not_beer"); // מכבי alone
    expect(classify(item("למברוסקו ספומנטה לבן 750 מל CORONA")).verdict).toBe("not_beer"); // a wine sharing a brand name
    expect(classify(item("פקדון בקבוק")).verdict).toBe("not_beer");
    expect(classify(item("בקבוק בירה חוזר ריק")).verdict).toBe("not_beer");
  });

  it("keeps non-alcoholic, malt, cider and radler out of scope by default (owner decision pending)", () => {
    expect(classify(item("בירה שחורה נשר")).verdict).toBe("out_of_scope");
    expect(classify(item("היינקן 0.0 ללא אלכוהול")).verdict).toBe("out_of_scope");
    expect(classify(item("בירה מאלט")).verdict).toBe("out_of_scope");
  });

  it("no real row that names one of our beers is a look-alike", () => {
    for (const it of all.filter((r) => /נסטלה|גינסנג|למברוסקו/.test(r.item_name))) expect(classify(it).beer, it.item_name).toBeNull();
  });
});

describe("the pack", () => {
  it("reads 6×330 bottles from the name and checks it against the total volume", () => {
    expect(parsePack(item("בירה קרלסברג בק6*330 מ\"ל", "1.98", "ליטר"))).toMatchObject({ container: "bottle", volume_ml: 330, pack_quantity: 6, confidence: "confident" });
    expect(parsePack(item("בירה באדוויזר 6*330 מ\"ל", "1980.00", "100 מיליליטר"))).toMatchObject({ volume_ml: 330, pack_quantity: 6 });
  });

  it("reads a single can from its size", () => {
    expect(parsePack(item("בירה גינס פחית 440 מ\"ל", "440.00", "100 מיליליטר"))).toMatchObject({ container: "can", volume_ml: 440, pack_quantity: 1, confidence: "confident" });
  });

  it("ח\"פ is one-way (חד-פעמי), not a can", () => {
    expect(parsePack(item("גולדסטאר ח\"פ 250 מ\"ל")).container).toBeNull();
    expect(parsePack(item("היינקן ח\"פ 330 בקבוק")).container).toBe("bottle");
  });

  it("does not trust 'יחידות' as a volume, and never guesses a pack", () => {
    expect(parsePack(item("סומרסבי מנגו ליים", "1.00", "יחידות")).confidence).toBe("unresolved");
    expect(parsePack(item("בירה בדוויזר שישייה", "330.00", "100 מיליליטר")).confidence).toBe("unresolved"); // 6 × ? — no size
  });

  it("a name cut short: derives the pack from the total only when one standard multipack makes it, and says so", () => {
    const p = parsePack(item("מארז בירה מכבי 7.9%", "1.98", "קילוגרם")); // 'קילוגרם' is a mislabel of litres
    expect(p).toMatchObject({ volume_ml: 330, pack_quantity: 6, confidence: "partial" });
    expect(p.why).toContain("derived");
    expect(parsePack(item("מארז בירה גולדסטאר 5", "1.00", "קילוגרם")).confidence).toBe("unresolved"); // 1 L: 4×250? 1×1000?
  });

  it("sees returnable bottles", () => {
    expect(parsePack(item("בירה גולדסטאר ב.חוזר 500", "0.5", "ליטר")).returnable).toBe(true);
  });
});

describe("prices", () => {
  it("refuses zero and weighted prices, and a price that cannot belong to the pack", () => {
    const single = { container: "bottle", volume_ml: 330, pack_quantity: 1, returnable: false, confidence: "confident", why: "" } as const;
    expect(checkPrice({ ...item("x"), price: 0 }, single).ok).toBe(false);
    expect(checkPrice({ ...item("x"), is_weighted: true }, single).ok).toBe(false);
    expect(checkPrice({ ...item("x"), price: 33.9 }, single)).toMatchObject({ ok: false, reason: expect.stringContaining("multipack") }); // ₪103/L
    expect(checkPrice({ ...item("x"), price: 7.9 }, single)).toMatchObject({ ok: true, agorot: 790 });
  });

  it("every real single-can or 6-pack price of our beers passes", () => {
    for (const it of all) {
      if (!classify(it).beer) continue;
      const pack = parsePack(it);
      if (pack.confidence !== "confident") continue;
      const check = checkPrice(it, pack);
      if (!check.ok) expect(check.reason, it.item_name).toContain("multipack");
    }
  });
});

describe("promotions", () => {
  type P = Promo & { items: { item_code: string; min_qty?: string; discounted_price?: string }[] };
  const promo = (description: string, codes = 1, club = false, feed?: { min_qty: string; discounted_price: string }): P => ({
    promotion_id: "1",
    description,
    club_only: club,
    start: "2026-09-01T00:00:00.000",
    end: "2026-09-30T23:59:00.000",
    items: Array.from({ length: codes }, (_, i) => ({ item_code: String(i), ...feed })),
  });

  it("publishes a price only when the description and DiscountedPrice agree", () => {
    const both = readPromotion(promo("שישיית בירה גולדסטאר / מכבי 2 ב 55", 3, false, { min_qty: "2", discounted_price: "55.00" }));
    expect(both).toMatchObject({ kind: "multi_buy", qty: 2, total_agorot: 5500, basis: "description + DiscountedPrice", hold: false });
    expect(readPromotion(promo("שישיית בירה סטלה 24.9 מוג 2", 1, false, { min_qty: "1", discounted_price: "24.90" }))).toMatchObject({ kind: "price_cut", price_agorot: 2490, hold: false });
  });

  it("holds a price stated only once, or stated twice differently", () => {
    expect(readPromotion(promo("היינקן 2ב71.40"))).toMatchObject({ kind: "multi_buy", total_agorot: 7140, basis: "description only", hold: true });
    expect(readPromotion(promo("גולדסטאר ח פ בקבוק 6*330 מ ל", 1, false, { min_qty: "1", discounted_price: "24.90" }))).toMatchObject({ kind: "price_cut", basis: "DiscountedPrice only", hold: true });
    expect(readPromotion(promo("בירה 2 ב 15 מועדון", 1, true, { min_qty: "2", discounted_price: "14.90" }))).toMatchObject({ kind: "unmapped", hold: true, reason: expect.stringContaining("DiscountedPrice says") });
  });

  it("a 'פקדון' description quotes the price before the ₪0.30-per-container deposit; DiscountedPrice includes it", () => {
    const r = readPromotion(promo("2ב71.40 פקדון בירה סטלה ארטואה 6 * 330 מ", 1, false, { min_qty: "2", discounted_price: "75.00" }));
    expect(r).toMatchObject({ kind: "multi_buy", qty: 2, total_agorot: 7500, hold: false, reason: expect.stringContaining("12 × ₪0.30") });
    // Without the word, the same gap is a disagreement.
    expect(readPromotion(promo("2ב71.40 בירה סטלה", 1, false, { min_qty: "2", discounted_price: "75.00" })).hold).toBe(true);
  });

  it("holds a payment-method condition, and marks club offers", () => {
    expect(readPromotion(promo("שישייה ב99.90 אשראי", 1, false, { min_qty: "1", discounted_price: "99.90" }))).toMatchObject({ kind: "price_cut", price_agorot: 9990, hold: true });
    expect(readPromotion(promo("בירה 3 ב 20 מועדון", 1, true, { min_qty: "3", discounted_price: "20.00" }))).toMatchObject({ club: true, hold: false });
  });

  it("excludes store-wide coupons and compensation coupons", () => {
    expect(readPromotion(promo("10% הנחה בקנייה מעל 200", 7000)).kind).toBe("excluded");
    expect(readPromotion(promo("קופון פיצוי לקוח גולדסטאר 330 מל שישייה")).kind).toBe("excluded");
  });

  it("reads the price for the rows asked about only", () => {
    const mixed: P = { ...promo("x"), items: [{ item_code: "beer", min_qty: "2", discounted_price: "20.00" }, { item_code: "snack", min_qty: "1", discounted_price: "5.00" }] };
    expect(readPromotion(mixed)).toMatchObject({ kind: "unmapped", reason: expect.stringContaining("differ") });
    expect(readPromotion(mixed, new Set(["beer"]))).toMatchObject({ kind: "multi_buy", qty: 2, total_agorot: 2000 });
  });

  it("on the real files, most beer promotions carry two agreeing statements", () => {
    let agree = 0;
    let both = 0;
    for (const f of fixtures)
      for (const p of f.promotions) {
        const r = readPromotion(p);
        if (r.kind === "excluded" || r.basis.includes("only")) continue;
        both++;
        if (r.basis === "description + DiscountedPrice") agree++;
      }
    expect(both).toBeGreaterThan(40);
    expect(agree / both).toBeGreaterThan(0.9);
  });

  it("the supplement reads DiscountedPrice per promotion item from the raw XML", () => {
    const xml = "<Promotions><Promotion><PromotionID>0001116932</PromotionID><Groups><Group><PromotionItems>" +
      "<PromotionItem><ItemCode>7290000135557</ItemCode><MinQty>2</MinQty><DiscountedPrice>55.00</DiscountedPrice></PromotionItem>" +
      "<PromotionItem><ItemCode>7290008464697</ItemCode><DiscountedPrice/></PromotionItem>" +
      "</PromotionItems></Group></Groups></Promotion></Promotions>";
    const prices = discountedPrices(xml);
    expect([...prices]).toEqual([["0001116932|7290000135557", "55.00"]]);
    const merged = withDiscountedPrices([{ promotion_id: "0001116932", items: [{ item_code: "7290000135557" }, { item_code: "7290008464697" }] }], prices);
    expect(merged[0].items.map((i) => (i as { discounted_price?: string }).discounted_price)).toEqual(["55.00", ""]);
  });

  it("is in force only inside its Israel-time window", () => {
    const p = promo("x");
    expect(inForce(p, Date.parse("2026-09-15T12:00:00Z"))).toBe(true);
    expect(inForce(p, Date.parse("2026-09-30T20:00:00Z"))).toBe(true); // 23:00 in Israel, before 23:59
    expect(inForce(p, Date.parse("2026-09-30T21:30:00Z"))).toBe(false); // 00:30 on 1 Oct in Israel
    expect(inForce(p, Date.parse("2026-08-31T20:00:00Z"))).toBe(false); // 23:00 on 31 Aug in Israel
  });
});

describe("identity", () => {
  it("Israel wall-clock → UTC, summer and winter", () => {
    expect(new Date(israelTime("20260929051002")).toISOString()).toBe("2026-09-29T02:10:02.000Z"); // IDT +3
    expect(new Date(israelTime("2026-12-01T10:00:00.000")).toISOString()).toBe("2026-12-01T08:00:00.000Z"); // IST +2
  });

  it("only valid GTINs may match across chains", () => {
    expect(isGtin("7290008464024")).toBe(true);
    expect(isGtin("7290008464025")).toBe(false); // bad check digit
    expect(isGtin("264585")).toBe(false); // a chain's internal code
  });

  it("one barcode, one product: agreeing readings fill each other's gaps, disagreeing ones go to review", () => {
    const r = (chain: string, beer: string, container: string | null, ml = 500) => ({ code: "7290008464024", chain, beer, container, volume_ml: ml, pack_quantity: 1 });
    expect(reconcileBarcodes([r("a", "goldstar", "can"), r("b", "goldstar", null)]).get("7290008464024")).toEqual({ agree: true, container: "can" });
    expect(reconcileBarcodes([r("a", "tuborg-red", "can"), r("b", "tuborg", "can")]).get("7290008464024")).toMatchObject({ agree: false });
    expect(reconcileBarcodes([r("a", "corona", null, 355), r("b", "corona", null, 335)]).get("7290008464024")).toMatchObject({ agree: false });
  });

  it("feed file names parse from the right, both shapes", () => {
    expect(kindOf("PriceFull7290058140886-001-002-20260929-121501.gz")).toBe("PriceFull");
    expect(kindOf("promo7290027600007-001-002-202609290431.gz")).toBe("Promo");
    expect(parseFileName("PriceFull7290058140886-001-002-20260929-121501.gz")).toEqual({ chainId: "7290058140886", subChain: "001", store: "002", stamp: "20260929121501" });
    expect(parseFileName("PriceFull7290058140886-039-202607150513.gz")).toEqual({ chainId: "7290058140886", subChain: null, store: "039", stamp: "202607150513" });
  });
});

describe("the dry run cannot write", () => {
  it("imports no database client, reads no keys and opens no connection", () => {
    for (const file of ["scripts/ingest/dry-run.mjs", "scripts/ingest/lib/normalize.mjs", "scripts/ingest/lib/files.mjs", "scripts/ingest/lib/promo-supplement.mjs", "scripts/ingest/make-fixtures.mjs"]) {
      const src = readFileSync(join(__dirname, "..", file), "utf8");
      expect(src, file).not.toMatch(/@supabase|createClient|SERVICE_ROLE|SUPABASE_|process\.env|fetch\(|\.rpc\(/);
    }
  });
});
