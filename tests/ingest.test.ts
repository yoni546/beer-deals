import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inventoryPatch, withoutBlanks } from "../scripts/ingest/lib/branches.mjs";
import { kindOf, parseFileName } from "../scripts/ingest/lib/files.mjs";
import { audienceOf, checkPrice, classify, inForce, isGtin, israelTime, parsePack, readPromotion, reconcileBarcodes, variantOf } from "../scripts/ingest/lib/normalize.mjs";
import { discountedPrices, withDiscountedPrices } from "../scripts/ingest/lib/promo-supplement.mjs";
import { PUBLISHERS } from "../scripts/ingest/lib/publishers.mjs";
import { parseStores } from "../scripts/ingest/lib/stores-file.mjs";

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
  it("cover eight publishers, each with beer rows and promotions", () => {
    expect(fixtures.map((f) => f.chain).sort()).toEqual(["carrefour", "dor-alon", "hatzi-hinam", "osher-ad", "rami-levy", "shufersal", "tiv-taam", "yochananof"]);
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

  it("shows beer, non-alcoholic beer and radler; keeps malt drinks and cider out (owner decision, 2026-09-29)", () => {
    expect(classify(item("היינקן 0.0 ללא אלכוהול"))).toMatchObject({ verdict: "beer", beer: "heineken", category: "non_alcoholic" });
    expect(classify(item("הייניקן בירה 0% בק'"))).toMatchObject({ verdict: "beer", category: "non_alcoholic" });
    expect(classify(item("מכבי שנדי אפרסק 6*330מ\"ל"))).toMatchObject({ verdict: "beer", beer: "maccabee", category: "radler" });
    expect(classify(item("בירה שחורה נשר")).verdict).toBe("out_of_scope");
    expect(classify(item("בירה מאלט"))).toMatchObject({ verdict: "out_of_scope", category: "malt" });
    expect(classify(item("סומרסבי מנגו ליים 330מ\"ל"))).toMatchObject({ verdict: "out_of_scope", category: "cider" });
  });

  it("a strength that ends in 0% is not non-alcoholic", () => {
    expect(classify(item("בירה גולדסטאר 10% 330 מ\"ל SLOW BREW")).category).toBe("beer");
    expect(classify(item("בירה דליריאום רד בטעמי פירות 8.0% 750 מל")).category).toBe("beer");
  });

  it("tells variants apart, including names cut at 20 characters", () => {
    expect(variantOf("goldstar", "בירה גולדסטאר לא מסו", "beer")).toEqual({ variant: "לא מסונן", known: true });
    expect(variantOf("goldstar", "בירה גולדסטאר ל.מסונ", "beer").variant).toBe("לא מסונן");
    expect(variantOf("goldstar", "גולדסטאר SLOW BREW פ", "beer").variant).toBe("סלואו ברו");
    expect(variantOf("goldstar", "בירה גולדסטאר ב.חוזר", "beer")).toEqual({ variant: "", known: true });
    expect(variantOf("heineken", "היינקן 0.0", "non_alcoholic").variant).toBe("0.0");
    expect(variantOf("maccabee", "מכבי שנדי אפרסק", "radler").variant).toBe("שנדי אפרסק");
    // A craft brewery has no single main beer: without a known variant it goes to review.
    expect(variantOf("alexander", "בירה אלכסנדר 330", "beer").known).toBe(false);
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

  it("ח\"פ is a one-way glass bottle (never פח, a can); a returnable is a bottle; 'פחי' is פחית cut short", () => {
    expect(parsePack(item("גולדסטאר ח\"פ 250 מ\"ל")).container).toBe("bottle");
    expect(parsePack(item("היינקן ח\"פ 330 בקבוק")).container).toBe("bottle");
    expect(parsePack(item("בירה גולדסטאר ב.חוזר", "0.5", "ליטר"))).toMatchObject({ container: "bottle", returnable: true });
    expect(parsePack(item("סטלה בירה ארטואה פחי", "440", "מיליליטר")).container).toBe("can");
    expect(parsePack(item("בירה הייניקן שישייה")).container).toBeNull(); // not guessed
  });

  it("does not trust 'יחידות' as a volume, and never guesses a pack", () => {
    expect(parsePack(item("סומרסבי מנגו ליים", "1.00", "יחידות")).confidence).toBe("unresolved");
    expect(parsePack(item("בירה בדוויזר שישייה", "1.00", "יחידות")).confidence).toBe("unresolved"); // 6 × ? — no size
  });

  it("a pack word with ONE unit's size in Quantity (Rami Levy): 6 × that size, marked partial and explained", () => {
    const p = parsePack(item("בירה בדוויזר שישייה", "330.00", "100 מיליליטר"));
    expect(p).toMatchObject({ volume_ml: 330, pack_quantity: 6, confidence: "partial" });
    expect(p.why).toContain("one unit");
    // A non-standard Quantity is never stretched into a size.
    expect(parsePack(item("בירה בדוויזר שישייה", "412.00", "100 מיליליטר")).confidence).toBe("unresolved");
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

  it("a 'פקדון' description quotes the price without the ₪0.30-per-container deposit; that price is kept, like a shelf price", () => {
    const r = readPromotion(promo("2ב71.40 פקדון בירה סטלה ארטואה 6 * 330 מ", 1, false, { min_qty: "2", discounted_price: "75.00" }));
    expect(r).toMatchObject({ kind: "multi_buy", qty: 2, total_agorot: 7140, hold: false, depositInDescription: true, depositGap: 360 });
    // Without the word, the same gap is a disagreement.
    expect(readPromotion(promo("2ב71.40 בירה סטלה", 1, false, { min_qty: "2", discounted_price: "75.00" })).hold).toBe(true);
  });

  it("holds every offer that is not for everyone: card, club, coupon, employees", () => {
    expect(readPromotion(promo("שישייה ב99.90 אשראי", 1, false, { min_qty: "1", discounted_price: "99.90" }))).toMatchObject({ kind: "price_cut", audience: "payment", hold: true });
    expect(readPromotion(promo("בירה 3 ב 20 מועדון", 1, true, { min_qty: "3", discounted_price: "20.00" }))).toMatchObject({ audience: "club", club: true, hold: true });
  });

  it("reads the feed's club codes conservatively (0 = everyone, 1 club, 2 card, 3 other)", () => {
    const who = (club_id_raw: string, description = "בירה 2 ב 20") => audienceOf({ club_id_raw, description, club_only: false }).audience;
    expect(who("0")).toBe("everyone");
    expect(who("0 - כלל הלקוחות")).toBe("everyone");
    expect(who("1 - המועדון החדש")).toBe("club");
    expect(who("(2=מועדון קרפור אשראי|2=מועדון אפליקציה)")).toBe("payment");
    // Code 0 but the label names a card: the label wins.
    expect(who("(0=מועדון קרפור אשראי|0=מועדון אפליקציה)")).toBe("payment");
    expect(who("(3=תווי זיכוי מימוש|3=עיגול אגורות)")).toBe("coupon");
    expect(who("3 - מועדון עובדי ע.רעננה")).toBe("personal");
    expect(who("0", "בירה 2 ב 20 באפליקציה")).toBe("restricted");
  });

  it("reads '2 יח ב 27.90' as a multi-buy", () => {
    expect(readPromotion(promo("מבצע בירה שקמה 330 מ ל 2 יח ב 26.90 שח", 1, false, { min_qty: "2", discounted_price: "26.90" }))).toMatchObject({ kind: "multi_buy", qty: 2, total_agorot: 2690, hold: false });
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
    expect(reconcileBarcodes([r("a", "goldstar", "can"), r("b", "goldstar", null)]).get("7290008464024")).toMatchObject({ agree: true, container: "can", beer: "goldstar" });
    expect(reconcileBarcodes([r("a", "tuborg-red", "can"), r("b", "tuborg", "can")]).get("7290008464024")).toMatchObject({ agree: false });
    expect(reconcileBarcodes([r("a", "corona", null, 355), r("b", "corona", null, 335)]).get("7290008464024")).toMatchObject({ agree: false });
  });

  it("a name cut at 20 characters takes the specific identity the full names agree on — and never overrides one", () => {
    const at = (chain: string, name: string, beer: string, variant = "", category = "beer") => ({ code: "7290008464024", chain, name, beer, variant, category, container: "can", volume_ml: 500, pack_quantity: 1 });
    // "בירה גולדסטאר לא מסו" (20) → the full name's "לא מסונן"
    expect(reconcileBarcodes([at("a", "גולדסטאר פח לא מסונן500מ", "goldstar", "לא מסונן"), at("b", "בירה גולדסטאר פחית 5", "goldstar")]).get("7290008464024")).toMatchObject({ agree: true, variant: "לא מסונן" });
    // A FULL-length plain name is evidence: Tuborg vs Tuborg Red stays a conflict.
    expect(reconcileBarcodes([at("a", "טובורג רד פחית פקדון", "tuborg-red"), at("b", "בירה טובורג פחית 500 מ\"ל", "tuborg")]).get("7290008464024")).toMatchObject({ agree: false });
  });

  it("feed file names parse from the right, both shapes", () => {
    expect(kindOf("PriceFull7290058140886-001-002-20260929-121501.gz")).toBe("PriceFull");
    expect(kindOf("promo7290027600007-001-002-202609290431.gz")).toBe("Promo");
    expect(parseFileName("PriceFull7290058140886-001-002-20260929-121501.gz")).toEqual({ chainId: "7290058140886", subChain: "001", store: "002", stamp: "20260929121501" });
    expect(parseFileName("PriceFull7290058140886-039-202607150513.gz")).toEqual({ chainId: "7290058140886", subChain: null, store: "039", stamp: "202607150513" });
  });
});

describe("publishers and their branches", () => {
  it("decides the retailer per branch from the publisher's Stores file, never from the URL", () => {
    expect(PUBLISHERS.carrefour.retailer({ store: "80", name: "יינות ביתן טבעון" })).toBe("yeinot-bitan");
    expect(PUBLISHERS.carrefour.retailer({ store: "2", name: "קרפור מרקט אשקלון" })).toBe("carrefour");
    expect(PUBLISHERS["dor-alon"].retailer({ store: "401", subChainName: "AM:PM", name: "AM-PMדרך השלום" })).toBe("ampm");
    expect(PUBLISHERS["dor-alon"].retailer({ store: "12", subChainName: "אלונית מיני סופר", name: "אלונית" })).toBeNull();
    expect(PUBLISHERS.freshmarket.retailer({ store: "2", name: "פרשמרקט גליל ים" })).toBe("fresh-market");
    expect(PUBLISHERS.freshmarket.retailer({ store: "5", name: "היפר דודו שוק" })).toBeNull(); // another banner on the same account
  });

  it("marks the chains that need a password as blocked, with the reason — never forced", () => {
    for (const slug of ["super-yuda", "salach-dabach", "yellow"]) {
      expect(PUBLISHERS[slug].blocked, slug).toMatch(/requires a password/);
      expect(Object.keys(PUBLISHERS[slug]), slug).not.toContain("password");
    }
  });

  it("reads a UTF-16 Stores file with a BOM (as Carrefour publishes it) and flat Cerberus-style ones", () => {
    const xml = "<Root><ChainID>7290055700007</ChainID><SubChains><SubChain><SubChainID>001</SubChainID><SubChainName>1</SubChainName><Stores>" +
      "<Store><StoreID>080</StoreID><StoreName>יינות ביתן טבעון</StoreName><City>2300</City></Store></Stores></SubChain></SubChains></Root>";
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]);
    expect(parseStores(utf16)).toEqual([{ chain: "7290055700007", subChain: "001", subChainName: "1", store: "080", name: "יינות ביתן טבעון", address: "", city: "2300" }]);
    const flat = "<Root><ChainId>7290492000005</ChainId><Stores><Store><ChainId>7290492000005</ChainId><SubChainId>2</SubChainId><SubChainName>AM:PM</SubChainName><StoreId>401</StoreId><StoreName>AM-PM</StoreName></Store></Stores></Root>";
    expect(parseStores(Buffer.from(flat))[0]).toMatchObject({ subChainName: "AM:PM", store: "401" });
  });
});

describe("the dry run cannot write", () => {
  it("imports no database client, reads no keys and opens no connection", () => {
    for (const file of ["scripts/ingest/dry-run.mjs", "scripts/ingest/lib/normalize.mjs", "scripts/ingest/lib/files.mjs", "scripts/ingest/lib/promo-supplement.mjs", "scripts/ingest/lib/plan.mjs", "scripts/ingest/lib/report.mjs", "scripts/ingest/lib/publishers.mjs", "scripts/ingest/lib/stores-file.mjs", "scripts/ingest/lib/branches.mjs", "scripts/ingest/make-fixtures.mjs"]) {
      const src = readFileSync(join(__dirname, "..", file), "utf8");
      expect(src, file).not.toMatch(/@supabase|createClient|SERVICE_ROLE|SUPABASE_|process\.env|fetch\(|\.rpc\(/);
    }
  });
});

describe("a scan without a Stores file (Fresh Market) keeps what is known about its branches", () => {
  const at = "2026-10-05T04:50:00.000Z";

  it("with a Stores file read, writes the branch's name, place and whether the file lists it", () => {
    expect(inventoryPatch({ name: "פרשמרקט גליל ים", city: "הרצליה", address: "" }, { at, storesFileRead: true })).toEqual({
      name_he: "פרשמרקט גליל ים", city: "הרצליה", listed_in_stores_file: true, source_listed_at: at,
    });
    // Listed in price files but not in the Stores file that WAS read: that is real evidence.
    expect(inventoryPatch({ name: "", notInStoresFile: true }, { at, storesFileRead: true })).toEqual({ listed_in_stores_file: false, source_listed_at: at });
  });

  it("without one, a branch known only from its price file changes nothing: no blank name, no 'not listed'", () => {
    expect(inventoryPatch({ name: "", city: "", address: "", notInStoresFile: true }, { at, storesFileRead: false })).toEqual({});
  });

  it("never sends an empty value to overwrite a stored one", () => {
    expect(withoutBlanks({ name_he: null, city: undefined, address: "", last_seen_at: at })).toEqual({ last_seen_at: at });
  });

  it("the writer uses it for every branch it writes, and skips an update with nothing in it", () => {
    const run = readFileSync(join(__dirname, "..", "scripts/ingest/run.mjs"), "utf8");
    expect(run).toContain("inventoryPatch(b, { at, storesFileRead })");
    expect(run).toContain("...withoutBlanks({ name_he: u.branch.name_he");
    expect(run).toContain('if (Object.keys(patchRow).length) await must("branch update"');
    expect(run).not.toContain("name_he: b.name || null");
  });
});

describe("the writer's target", () => {
  it("proves its target through lib/target.mjs and reads credentials only from the git-ignored files", () => {
    for (const file of ["scripts/ingest/run.mjs", "scripts/ingest/baseline-notifications.mjs"]) {
      const src = readFileSync(join(__dirname, "..", file), "utf8");
      expect(src, file).toContain("loadTarget(ROOT, args)");
      // Never from the shell environment.
      expect(src.includes("process.env"), file).toBe(false);
    }
    const target = readFileSync(join(__dirname, "..", "scripts/ingest/lib/target.mjs"), "utf8");
    expect(target.includes("process.env")).toBe(false);
    expect(target).toContain('staging: ".env.staging.local", production: ".env.production.local"');
  });
});

describe("the daily ingestion workflow", () => {
  it("targets staging only, reads only staging secrets, and announces nothing after a failed import", () => {
    const yml = readFileSync(join(__dirname, "..", ".github/workflows/ingest-staging.yml"), "utf8");
    expect(yml).toContain("run.mjs --target staging");
    expect(yml).not.toMatch(/--target\s+production/);
    // Every secret it names is a staging one.
    const secrets = [...yml.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
    expect(secrets.length).toBeGreaterThan(0);
    for (const s of secrets) expect(s, s).toMatch(/^STAGING_/);
    // The notification step runs only when everything before it succeeded (the quality gate exits non-zero).
    expect(yml).toMatch(/Ring the staging notification worker[\s\S]*?if: success\(\)/);
    expect(readFileSync(join(__dirname, "..", "scripts/ingest/run.mjs"), "utf8")).toContain("process.exit(2)");
  });

  it("the writer survives a statement timeout and never leaves a run 'running' when it stops", () => {
    const run = readFileSync(join(__dirname, "..", "scripts/ingest/run.mjs"), "utf8");
    // Every database call is passed as a function, so a timed-out (rolled-back) statement can be sent again.
    expect(run).not.toMatch(/must\(\s*("[^"]*"|`[^`]*`),\s*db\./);
    expect(run).toMatch(/error\?\.code === "57014"/);
    // A price batch that times out is split rather than given up on.
    expect(run).toMatch(/sending them as two halves/);
    // Any failure closes the runs this write started as failed, then stops with a non-zero exit.
    expect(run).toMatch(/async function abort[\s\S]*?finish_ingestion_run[\s\S]*?p_status: "failed"[\s\S]*?throw new Error\(message\)/);
  });
});

describe("the production ingestion workflow", () => {
  const yml = readFileSync(join(__dirname, "..", ".github/workflows/ingest-production.yml"), "utf8");

  it("is manual only, one run at a time, and reads only PRODUCTION_* secrets", () => {
    expect(yml).toMatch(/on:\s*\n\s*workflow_dispatch:/);
    expect(yml).not.toMatch(/^\s*schedule:/m);
    expect(yml).toMatch(/concurrency:\s*\n\s*group: ingest-production\s*\n\s*cancel-in-progress: false/);
    const secrets = [...yml.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
    expect(secrets.length).toBeGreaterThan(0);
    expect(secrets.every((s) => s.startsWith("PRODUCTION_"))).toBe(true);
  });

  it("fails (not skips) without its secrets, refuses the staging ref, and passes the typed ref to the writer", () => {
    expect(yml).toMatch(/are not set\. Nothing was written[\s\S]*?exit 1/);
    expect(yml).toContain('if [ "$CONFIRM_REF" = "qpjwnxptitnmtsznjvkw" ]');
    expect(yml).toContain('run.mjs --target production --confirm-ref "$CONFIRM_REF"');
    expect(yml).toContain("APP_ENV=production");
  });

  it("never rings the notification worker, never resets or rolls back, and baselines the first import", () => {
    expect(yml).not.toMatch(/api\/notifications\/run|CRON_SECRET/);
    expect(yml).not.toMatch(/--reprocess|--full|delete from|truncate/i);
    expect(yml).toMatch(/if: inputs\.initial_population\s*\n[\s\S]*?baseline-notifications\.mjs --target production --confirm-ref "\$CONFIRM_REF" --apply/);
  });
});

describe("cases, kegs and crates (0.9.0 audit)", () => {
  const row = (name: string, price: number, quantity = "1.00", unit = "יחידות") => ({ item_code: "7290000000446", item_name: name, manufacturer: "", price, quantity, unit_of_measure: unit, is_weighted: false });

  it("the empty returnable crate ('ארגז גולדסטאר' at ₪25.90) is not beer", () => {
    expect(classify(row("ארגז גולדסטאר", 25.9, "0.00", "יחידה"))).toMatchObject({ verdict: "not_beer", reason: expect.stringContaining("crate") });
    expect(classify(row("ארגז קרלסברג/טובורג", 19.9, "0.00", "יחידה")).verdict).toBe("not_beer");
    // A real case says what it holds and costs what 24 beers cost: it stays beer.
    expect(classify(row("ארגז בירה 4 שישיות קרלסברג", 160)).verdict).toBe("beer");
  });

  it("a 5-litre keg is never read as 20×250", () => {
    expect(parsePack(row("בירה אייל חיטה 5.3%", 99.9, "5.00", "1 ליטר")).pack_quantity).not.toBe(20);
  });

  it("24- and 12-packs are read as cases", () => {
    expect(parsePack(row("בירה גולדסטאר 24*330 מ\"ל פחית", 99, "7.92", "ליטר"))).toMatchObject({ pack_quantity: 24, volume_ml: 330 });
    expect(parsePack(row("ארגז 12 בקבוקי מכבי 500 מ\"ל", 79, "6.00", "ליטר"))).toMatchObject({ pack_quantity: 12, volume_ml: 500 });
  });
});

describe("a carton of cans (0.9.0 audit)", () => {
  it("12 L of cans with the count cut off is 24×500 — a can is never a litre", () => {
    const row = { item_code: "7290018824450", item_name: "פחית קרלסברג קרטון 2", manufacturer: "", price: 120, quantity: "12.00", unit_of_measure: "1ליטר", is_weighted: false };
    expect(parsePack(row)).toMatchObject({ container: "can", pack_quantity: 24, volume_ml: 500 });
  });
});
