/**
 * Dry-run normalisation of price-transparency rows (as emitted by the installed skill's
 * scripts/parse_price_xml.py) into this app's catalogue terms: is it beer, which of our beers,
 * which physical pack (container · volume_ml · pack_quantity), is the price believable, and what
 * does a promotion say. Pure functions, no I/O — tested against real rows in tests/fixtures/ingest/.
 *
 * Everything that cannot be decided with confidence is REPORTED, never guessed into a SKU.
 */

/** Hebrew letters, for word boundaries (JS \b does not know Hebrew). */
const HE = "֐-׿";
// A digit may touch a name ("מכבי7.9%"), a letter may not ("גינסנג", "נסטלה").
const word = (w) => new RegExp(`(^|[^${HE}A-Za-z])${w}(?=$|[^${HE}A-Za-z])`, "i");

export function clean(text) {
  return String(text ?? "")
    .replace(/[֑-ׇ]/g, "") // niqqud
    .replace(/[״"'`׳]/g, "") // quotes and geresh: מ"ל → מל, בק' → בק
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Our beers and how shelves write them. `alone`: the name is unambiguous on its own. Otherwise the
 * row must also say "בירה" or come from a known brewer — "מכבי" alone is also a health fund, "גינס"
 * alone is the start of "גינסנג", "נגב" is a region, "לף" a syllable.
 */
export const BRANDS = [
  { slug: "goldstar", names: ["גולדסטאר", "גולד סטאר", "goldstar"], alone: true },
  { slug: "heineken", names: ["היינקן", "הייניקן", "heineken"], alone: true },
  { slug: "carlsberg", names: ["קרלסברג", "carlsberg"], alone: true },
  { slug: "tuborg-red", names: ["טובורג אדום", "טובורג רד", "tuborg red"], alone: true },
  { slug: "tuborg", names: ["טובורג", "tuborg"], alone: true },
  { slug: "corona", names: ["קורונה", "corona"], alone: true },
  { slug: "stella", names: ["סטלה ארטואה", "סטלה ארטוא", "stella artois", "סטלה"], alone: false },
  { slug: "becks", names: ["בקס", "becks"], alone: false },
  { slug: "paulaner", names: ["פאולנר", "paulaner"], alone: true },
  { slug: "weihen", names: ["ויינשטפן", "וויינשטפן", "weihenstephaner"], alone: true },
  { slug: "erdinger", names: ["ארדינגר", "erdinger"], alone: true },
  { slug: "guinness", names: ["גינס", "guinness"], alone: false },
  { slug: "leffe", names: ["לף", "leffe"], alone: false },
  { slug: "desperados", names: ["דספרדוס", "desperados"], alone: true },
  { slug: "budweiser", names: ["באדוויזר", "בודווייזר", "בדוויזר", "budweiser"], alone: true },
  { slug: "maccabee", names: ["מכבי", "maccabee"], alone: false },
  { slug: "shapiro", names: ["שפירא"], alone: false },
  { slug: "alexander", names: ["אלכסנדר"], alone: false },
  { slug: "malka", names: ["מלכה"], alone: false },
  { slug: "negev", names: ["נגב"], alone: false },
  { slug: "bazelet", names: ["בזלת"], alone: false },
  { slug: "somersby", names: ["סומרסבי", "סאמרסבי", "somersby"], alone: true },
];

/** Manufacturer names that mean "this is a beer" when the product name is not explicit. */
const BREWERS = ["טמפו", "קרלסברג", "החברה המרכזית", "היינקן", "מבשלת", "brewery", "brauerei", "bräu", "brau"];

/** Rows that mention beer (or a beer brand) but are not a beer to drink. */
const NOT_A_BEER = [
  [/^(פקדון|פיקדון)|ריק(\s|$)|ארגז פלסטיק/, "deposit / empty container"],
  [/כוס|כוסות|ספל|פותחן|מקרר/, "accessory"],
  [/(^|\s)יין|למברוסקו|ספומנטה|וודקה|ויסקי|וויסקי|ליקר|ערק|טקילה|רום(\s|$)/, "wine or spirits (brand name shared)"],
  [/שמרי בירה|שמרים/, "yeast"],
  [/חומץ/, "vinegar"],
  [/סבון|שמפו|קרם|תרסיס/, "cosmetic"],
];

/** In a beer's world but outside the product's default scope (owner decision, docs/INGESTION-READINESS.md §6). */
const OUT_OF_SCOPE = [
  [/מאלט|בירה שחורה/, "malt drink (non-alcoholic)"],
  [/ללא אלכוהול|נטול אלכוהול|0\.0|0%|אלכוהול 0/, "non-alcoholic"],
  [/סיידר/, "cider"],
  [/רדלר|שנדי/, "radler / shandy"],
];

/**
 * @returns {{verdict: "beer" | "not_beer" | "out_of_scope", beer: string | null, reason: string}}
 *   beer = one of our slugs, or null for a beer we do not carry.
 */
export function classify(item) {
  const name = clean(item.item_name);
  const maker = clean(item.manufacturer);
  const saysBeer = word("בירה").test(name) || /beer|bier/i.test(name);
  const byBrewer = BREWERS.some((b) => maker.toLowerCase().includes(b.toLowerCase()));

  let brand = null;
  for (const b of BRANDS) {
    if (b.names.some((n) => word(clean(n)).test(name)) && (b.alone || saysBeer || byBrewer)) {
      brand = b.slug;
      break;
    }
  }
  if (!brand && !saysBeer) return { verdict: "not_beer", beer: null, reason: "no beer word, no known brand" };
  for (const [re, reason] of NOT_A_BEER) if (re.test(name)) return { verdict: "not_beer", beer: null, reason };

  for (const [re, reason] of OUT_OF_SCOPE) if (re.test(name)) return { verdict: "out_of_scope", beer: brand, reason };
  if (brand === "somersby") return { verdict: "beer", beer: brand, reason: "in our catalogue (a cider)" };
  return { verdict: "beer", beer: brand, reason: brand ? "known brand" : "beer we do not carry" };
}

const STANDARD_ML = [250, 275, 330, 333, 335, 355, 440, 473, 500, 568, 650, 750, 1000];
const WORD_COUNTS = [
  [/שישי?י?ה|שישיית|6 ?פק/, 6],
  [/רביעי?י?ה|רביעיית/, 4],
  [/שלישי?י?ה/, 3],
  [/ארגז/, 24],
];

/**
 * The physical pack, from the name and the Quantity field.
 * Quantity is the pack's total volume, in a unit the skill's output does not carry (the XML's
 * UnitQty is dropped): for beer, ≥ 50 means millilitres, less means litres.
 *
 * @returns {{container: "can"|"bottle"|null, volume_ml: number|null, pack_quantity: number|null,
 *            returnable: boolean, confidence: "confident"|"partial"|"unresolved", why: string}}
 */
export function parsePack(item) {
  const name = clean(item.item_name).replace(/[×Xx]/g, "*");
  // "ח\"פ" (→ "חפ") is חד-פעמי, one-way — not פח, a can.
  const container = /פחית|פחיות|(^|\s)פח(\s|$|\d)/.test(name) ? "can" : /בקבוק|בקבוקים|(^|\s)בק(\s|$|\d)|בקב/.test(name) ? "bottle" : null;
  const returnable = /רב פעמי|רב-פעמי|(^|\s)רב(\s|$)|חוזר/.test(name);

  let count = null;
  let unit = null;
  const star = name.match(/(\d{1,2})\s*\*\s*(\d{3,4})/) ?? name.match(/(\d{3,4})\s*\*\s*(\d{1,2})(?!\d)/);
  if (star) {
    const [a, b] = [Number(star[1]), Number(star[2])];
    [count, unit] = a < 50 ? [a, b] : [b, a];
  }
  if (!unit) {
    const ml = name.match(/(\d{3,4})\s*(מל|מ ל|ml|מיליליטר)/i);
    if (ml) unit = Number(ml[1]);
  }
  if (!unit) {
    const litre = name.match(/(\d(?:\.\d+)?)\s*(ליטר|ל)(\s|$)/);
    if (litre) unit = Math.round(Number(litre[1]) * 1000);
  }
  if (!unit) {
    const bare = [...name.matchAll(/(^|\D)(\d{3})(?!\d)/g)].map((m) => Number(m[2])).find((n) => STANDARD_ML.includes(n));
    if (bare) unit = bare;
  }
  if (!count) for (const [re, n] of WORD_COUNTS) if (re.test(name)) count = n;
  // Names are cut at ~20 characters at several chains ("…שיש", "…6* 3"): a truncated pack word.
  if (!count && /(^|\s)(שיש|שישי|רביע)[^\s]*$/.test(name)) count = /רביע/.test(name) ? 4 : 6;
  if (!count) {
    const pack = name.match(/(מארז|מגש|ארגז)\s*(\d{1,2})(?!\d)/) ?? name.match(/(\d{1,2})\s*(יח|יחידות|פחיות|בקבוקים)/);
    if (pack) count = Number(pack[2] ?? pack[1]);
  }

  // Quantity is a volume only when its unit says so ("קילוגרם" is a common mislabel of litres);
  // "יחידות" counts shelf units and says nothing about volume.
  const q = Number(item.quantity);
  const volumeUnit = /ליטר|מל|מיליליטר|קילוגרם|גרם|קג/.test(clean(item.unit_of_measure));
  const total = volumeUnit && Number.isFinite(q) && q > 0 ? (q >= 50 ? q : q * 1000) : null;
  if (unit && !count && total) {
    const ratio = total / unit;
    if (Math.abs(ratio - Math.round(ratio)) < 0.03 && Math.round(ratio) >= 1 && Math.round(ratio) <= 30) count = Math.round(ratio);
  }
  if (!unit && total && count) {
    const per = total / count;
    if (STANDARD_ML.some((s) => Math.abs(s - per) <= 2)) unit = STANDARD_ML.find((s) => Math.abs(s - per) <= 2);
  }
  if (unit && !count && total && Math.abs(total - unit) < 2) count = 1;
  // No size in the name, no pack word, and the total is one single-serve size: one can or bottle.
  // (1 L is left out: 4×250 multipacks carry the same total.)
  if (!unit && !count && total && total <= 750 && STANDARD_ML.includes(Math.round(total))) [unit, count] = [Math.round(total), 1];
  // Only the total is known (name truncated before the size): accept it when exactly one
  // multipack of a standard size makes it — 1980 → 6×330, 2130 → 6×355 — and mark it derived.
  let derived = false;
  if (!unit && total && !STANDARD_ML.includes(Math.round(total))) {
    const options = [4, 6, 12, 20, 24]
      .filter((n) => !count || n === count)
      .flatMap((n) => STANDARD_ML.filter((ml) => Math.abs(ml * n - total) <= 2).map((ml) => [n, ml]));
    if (options.length === 1) {
      [count, unit] = options[0];
      derived = true;
    }
  }

  const consistent = unit && count && total ? Math.abs(unit * count - total) / total <= 0.03 : Boolean(unit && count);
  const why = [];
  if (!unit) why.push("volume unknown");
  if (!count) why.push("pack size unknown");
  if (!container) why.push("container unknown");
  if (unit && count && total && !consistent) why.push(`name says ${count}×${unit} ml but Quantity says ${total} ml`);
  if (derived) why.push(`pack derived from the total volume ${total} ml`);

  const confidence = unit && count && consistent ? (container && !derived ? "confident" : "partial") : "unresolved";
  return { container, volume_ml: unit, pack_quantity: count, returnable, confidence, why: why.join("; ") };
}

/** Price sanity for a beer pack (agorot). */
export function checkPrice(item, pack) {
  const agorot = Math.round(Number(item.price) * 100);
  if (!Number.isFinite(agorot) || agorot <= 0) return { ok: false, agorot, reason: "price is zero or missing" };
  if (item.is_weighted) return { ok: false, agorot, reason: "weighted item" };
  if (pack.volume_ml && pack.pack_quantity) {
    const perLitre = agorot / ((pack.volume_ml * pack.pack_quantity) / 1000);
    if (perLitre < 800) return { ok: false, agorot, reason: `₪${(perLitre / 100).toFixed(2)} per litre is implausibly low` };
    if (perLitre > 7000) return { ok: false, agorot, reason: `₪${(perLitre / 100).toFixed(2)} per litre is implausibly high — likely a multipack whose name lost its pack size` };
  }
  return { ok: true, agorot, reason: "" };
}

/** Israel's beverage-container deposit, per container up to 1.5 L. */
export const DEPOSIT_AGOROT = 30;

/**
 * What a promotion says, conservatively. Two independent statements of its price exist:
 *   - the description, in forms we can state exactly: "2 ב 55" / "2ב71.40" (multi-buy: qty for total),
 *     "ב 24.90" or a lone "24.9" (a price cut);
 *   - the item's <DiscountedPrice> with its <MinQty> (the total paid for MinQty units — "2 ב 55" is
 *     MinQty 2, DiscountedPrice 55.00). The skill's parser drops this field for the dialect every chain
 *     uses, so lib/promo-supplement.mjs fills it in.
 * RewardType meanings are unsourced (the skill says so) and are not used. A promotion may be published
 * only when both statements exist and agree (`hold: false`); one statement alone, a disagreement, a
 * payment condition or per-item prices that differ are reported and HELD for review — never applied.
 *
 * @param {{description: string, club_only: boolean, items: Array<{item_code: string, min_qty?: string, discounted_price?: string}>}} promo
 *   a promotion as the skill emits it (+ discounted_price per item)
 * @param {Set<string> | null} [codes] the item codes the price is read for (e.g. only the beer rows); all when omitted
 * @returns {{kind: "multi_buy"|"price_cut"|"unmapped"|"excluded", qty?: number, total_agorot?: number,
 *            price_agorot?: number, club: boolean, basis: string, hold: boolean, reason: string}}
 */
export function readPromotion(promo, codes = null) {
  const text = clean(promo.description);
  const club = Boolean(promo.club_only);
  const held = (kind, reason, extra = {}) => ({ kind, club, basis: "", hold: true, reason, ...extra });
  if (promo.items.length > 50) return held("excluded", `applies to ${promo.items.length} items — a store-wide coupon, not a beer offer`);
  if (/קופון|פיצוי|מתנה/.test(text)) return held("excluded", "coupon / compensation, not a shelf offer");

  const said = fromDescription(text);
  const items = codes ? promo.items.filter((i) => codes.has(i.item_code)) : promo.items;
  const feed = fromFeed(items);
  const shape = (r) => (r.qty > 1 ? { kind: "multi_buy", qty: r.qty, total_agorot: r.total } : { kind: "price_cut", price_agorot: r.total });
  const show = (r) => (r.qty > 1 ? `${r.qty} for ₪${(r.total / 100).toFixed(2)}` : `₪${(r.total / 100).toFixed(2)}`);
  const payment = /אשראי|כרטיס/.test(text) ? "conditional on a payment method" : "";

  if (feed?.varies) return held("unmapped", "the items' DiscountedPrice values differ");
  if (said && feed) {
    // "2ב71.40 פקדון …": the description quotes the price before the bottle deposit, DiscountedPrice
    // includes it (75.00 = 71.40 + 12 containers × ₪0.30). Seen on every such Shufersal row, 2026-09-29.
    const gap = feed.total - said.total;
    if (said.qty === feed.qty && /פקדון/.test(text) && gap > 0 && gap % DEPOSIT_AGOROT === 0 && gap / DEPOSIT_AGOROT <= 48) {
      return { ...shape(feed), club, basis: "description + DiscountedPrice", hold: Boolean(payment), reason: [payment, `description excludes the deposit (${gap / DEPOSIT_AGOROT} × ₪0.30)`].filter(Boolean).join("; ") };
    }
    if (said.qty !== feed.qty || said.total !== feed.total) return held("unmapped", `description says ${show(said)}, DiscountedPrice says ${show(feed)}`);
    return { ...shape(said), club, basis: "description + DiscountedPrice", hold: Boolean(payment), reason: payment };
  }
  if (said) return { ...shape(said), club, basis: "description only", hold: true, reason: [payment, "no DiscountedPrice to confirm it"].filter(Boolean).join("; ") };
  if (feed) return { ...shape(feed), club, basis: "DiscountedPrice only", hold: true, reason: [payment, "the description states no price to confirm it"].filter(Boolean).join("; ") };
  return held("unmapped", "no price in the description and no DiscountedPrice");
}

/** @returns {{qty: number, total: number} | null} */
function fromDescription(text) {
  const multi = text.match(/(\d{1,2})\s*ב\s*-?\s*(\d{1,4}(?:\.\d{1,2})?)(?!\d)/);
  if (multi && Number(multi[1]) >= 2 && Number(multi[2]) > 0) return { qty: Number(multi[1]), total: Math.round(Number(multi[2]) * 100) };
  const single = text.match(/(?:^|[^\d])ב\s*-?\s*(\d{1,4}(?:\.\d{1,2})?)(?!\d)/);
  const lone = [...text.matchAll(/(?:^|\s)(\d{1,3}\.\d{1,2})(?:\s|$)/g)].map((m) => Number(m[1]));
  const price = single ? Number(single[1]) : lone.length === 1 ? lone[0] : NaN;
  return price > 0 ? { qty: 1, total: Math.round(price * 100) } : null;
}

/** @returns {{qty: number, total: number} | {varies: true} | null} */
function fromFeed(items) {
  const read = items
    .filter((i) => Number(i.discounted_price) > 0)
    .map((i) => ({ qty: Math.max(1, Math.round(Number(i.min_qty) || 1)), total: Math.round(Number(i.discounted_price) * 100) }));
  if (read.length === 0) return null;
  const distinct = new Set(read.map((r) => `${r.qty}|${r.total}`));
  return distinct.size === 1 ? read[0] : { varies: true };
}

/**
 * Feed times are Israel local wall-clock without an offset ("2026-08-26T00:00:00.000", or a file
 * stamp "20260929051002"). → epoch ms, correct across the summer-time switch.
 */
export function israelTime(text) {
  const d = String(text ?? "").replace(/\D/g, "");
  if (d.length < 8) return NaN;
  const [y, mo, da, h, mi, s] = [d.slice(0, 4), d.slice(4, 6), d.slice(6, 8), d.slice(8, 10) || "0", d.slice(10, 12) || "0", d.slice(12, 14) || "0"].map(Number);
  const wall = Date.UTC(y, mo - 1, da, h, mi, s);
  const offsetAt = (utc) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(utc)
        .map((p) => [p.type, p.value]),
    );
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - utc;
  };
  const guess = wall - offsetAt(wall);
  return wall - offsetAt(guess);
}

/** Is a promotion in force at `now` (epoch ms)? (The skill: only inside its start/end window.) */
export function inForce(promo, now) {
  const start = israelTime(promo.start);
  const end = israelTime(promo.end);
  if (Number.isFinite(start) && now < start) return false;
  if (Number.isFinite(end) && now > end) return false;
  return true;
}

/**
 * One barcode is one product everywhere, so readings of the same GTIN at different chains must
 * agree. Where they agree, a reading that knows the container fills in one that does not; where
 * they disagree on beer, volume or pack, at least one chain's name was misread and every reading
 * of that barcode goes to review — the barcode is the tie-breaker only once a human has matched it.
 *
 * @param {Array<{code: string, chain: string, beer: string, container: string|null, volume_ml: number, pack_quantity: number}>} readings
 * @returns {Map<string, {agree: true, container: string|null} | {agree: false, why: string}>} by code
 */
export function reconcileBarcodes(readings) {
  const byCode = new Map();
  for (const r of readings) if (isGtin(r.code)) byCode.set(r.code, [...(byCode.get(r.code) ?? []), r]);
  const result = new Map();
  for (const [code, rs] of byCode) {
    const shapes = new Set(rs.map((r) => `${r.beer} ${r.pack_quantity}×${r.volume_ml}`));
    const containers = new Set(rs.map((r) => r.container).filter(Boolean));
    if (shapes.size > 1 || containers.size > 1) {
      const seen = rs.map((r) => `${r.chain}: ${r.beer} ${r.pack_quantity}×${r.volume_ml} ${r.container ?? ""}`.trim());
      result.set(code, { agree: false, why: `the same barcode reads differently — ${seen.join(" / ")}` });
    } else {
      result.set(code, { agree: true, container: [...containers][0] ?? null });
    }
  }
  return result;
}

/** GTIN-8/12/13/14 with a valid check digit — the only codes that may match across chains. */
export function isGtin(code) {
  const s = String(code ?? "").trim();
  if (!/^\d{8}$|^\d{12,14}$/.test(s)) return false;
  const digits = s.split("").map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
