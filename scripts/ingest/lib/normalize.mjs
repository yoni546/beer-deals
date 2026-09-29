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

/**
 * What kind of product a row is (migration 0014, product_categories). Beer, non-alcoholic beer and
 * radler are shown; malt drinks and cider are kept out for now. Order matters: "בירה שחורה נשר מאלט"
 * is a malt drink even though it says "בירה".
 */
const CATEGORY_RULES = [
  ["malt", /מאלט|מאלטי|בירה שחורה/, "malt drink"],
  ["cider", /סיידר/, "cider"],
  // "0.0", "0%", "ללא אלכוהול" — but not "10%", "8.0%" or "7.0%": no digit or point before the zero.
  ["non_alcoholic", /ללא אלכוהול|נטול אלכוהול|אלכוהול 0|(^|[^\d.])0(\.0)?\s*%|(^|[^\d.])0\.0(?!\d)|alcohol free|alkoholfrei/i, "non-alcoholic beer"],
  ["radler", /רדלר|שנדי|radler|shandy/i, "radler"],
];
export const IN_SCOPE = new Set(["beer", "non_alcoholic", "radler"]);

/**
 * Variants of our beers that are different products in the same pack ("גולדסטאר לא מסונן" is not
 * "גולדסטאר"). A variant not listed here falls back to '' (the beer's main product) — the barcode
 * check across and within chains is what catches an unlisted variant (lib/plan.mjs).
 * `required`: the brand has no single main product (craft breweries); without a variant it goes to review.
 */
export const VARIANTS = {
  // Truncated spellings count ("לא מסו", "ל.מסונ", "SLOW B"): chains cut names at ~20 characters.
  goldstar: { rules: [[/לא מס|ל\.\s?מסונ|(^|\s)UF(\s|$)|unfiltered/i, "לא מסונן"], [/slow ?b|slowbrew|סלואו|סלאו/i, "סלואו ברו"], [/לייט|light/i, "לייט"]] },
  heineken: { rules: [[/סילבר|silver/i, "סילבר"]] },
  // Carlsberg Luma is Carlsberg's unfiltered lager.
  carlsberg: { rules: [[/לומה|luma|לא מס|unfiltered/i, "לומה"]] },
  tuborg: { rules: [[/גולד|gold/i, "גולד"]] },
  corona: { rules: [[/סרוסה|cero/i, "סרו"]] },
  paulaner: { rules: [[/חיטה|ויס|וייס|weiss|hefe|מעונן|מעוננת/i, "חיטה"], [/דונקל|dunkel/i, "דונקל"], [/מינכן|הל(\s|$)|hell/i, "מינכן הל"]] },
  weihen: { rules: [[/דונקל|dunkel/i, "דונקל"], [/ויטוס|vitus/i, "ויטוס"], [/קריסטל|kristall/i, "קריסטל"], [/פילס|pils/i, "פילס"], [/אוריגינל|original|הלס/i, "אוריגינל"]] },
  erdinger: { rules: [[/דונקל|dunkel/i, "דונקל"], [/קריסטל|kristall/i, "קריסטל"]] },
  leffe: { rules: [[/בראון|brune|brown/i, "בראון"], [/רובי|ruby/i, "רובי"], [/טריפל|tripel/i, "טריפל"], [/בלונד|blond/i, ""]] },
  budweiser: { rules: [[/באדוור|בודוואר|budvar/i, "באדוור"]] },
  becks: { rules: [] },
  stella: { rules: [] },
  guinness: { rules: [] },
  desperados: { rules: [] },
  "tuborg-red": { rules: [] },
  maccabee: { rules: [] },
  malka: { required: true, rules: [[/בהיר|בלונד/, "בהירה"], [/אדמונית/, "אדמונית"], [/הינדי|אינדי|IPA/i, "הינדי"], [/חיטה/, "חיטה"], [/סטאוט|שחורה|כהה/, "סטאוט"]] },
  negev: { required: true, rules: [[/פאטה מורגנה/, "פאטה מורגנה"], [/אמבר|ענבר/, "אמבר"], [/פסיפלורה/, "פסיפלורה"], [/אלון|oak/i, "אלון"], [/פורטר|porter/i, "פורטר"], [/בלונד|blond/i, "בלונד"], [/IPA|אי פי איי/i, "IPA"]] },
  alexander: { required: true, rules: [[/בלונד|blond/i, "בלונד"], [/גרין|green/i, "גרין"], [/בלאק|black/i, "בלאק"], [/אמבר|ambree/i, "אמבר"], [/רובי|ruby/i, "רובי"], [/IPA|אי פי איי/i, "IPA"]] },
  shapiro: { required: true, rules: [[/פייל אייל|pale ale/i, "פייל אייל"], [/IPA|אי פי איי/i, "IPA"], [/סטאוט|stout|אוטמיל/i, "סטאוט"], [/חיטה|wheat/i, "חיטה"], [/אמבר|amber/i, "אמבר"]] },
  bazelet: { required: true, rules: [[/פילס|pils/i, "פילס"], [/אמבר|amber/i, "אמבר"], [/חיטה|wheat/i, "חיטה"], [/IPA/i, "IPA"], [/חלב|לאגר|lager/i, "לאגר"]] },
};

/**
 * @returns {{variant: string, known: boolean}} known = false when the brand needs a variant and none was found.
 */
export function variantOf(beer, name, category) {
  const text = clean(name);
  const spec = VARIANTS[beer] ?? { rules: [] };
  let variant = "";
  let found = false;
  for (const [re, label] of spec.rules) {
    if (re.test(text)) {
      variant = label;
      found = true;
      break;
    }
  }
  if (category === "non_alcoholic") variant = [variant, "0.0"].filter(Boolean).join(" ");
  if (category === "radler") {
    const flavour = (text.match(/(?:שנדי|רדלר)\s+(אפרסק|ליים|לימון ליים|לימון|אשכולית|תפוז)/) ?? [])[1];
    variant = ["שנדי", flavour].filter(Boolean).join(" ");
    found = true;
  }
  return { variant, known: found || !spec.required };
}

/**
 * @returns {{verdict: "beer" | "not_beer" | "out_of_scope", beer: string | null, category: string, reason: string}}
 *   beer = one of our slugs, or null for a beer we do not carry.
 */
export function classify(item) {
  const name = clean(item.item_name);
  const maker = clean(item.manufacturer);
  // "מכבי שנדי אפרסק" says beer without the word: a shandy / radler is beer-based.
  const saysBeer = word("בירה").test(name) || /beer|bier|שנדי|רדלר|radler|shandy/i.test(name);
  const byBrewer = BREWERS.some((b) => maker.toLowerCase().includes(b.toLowerCase()));

  let brand = null;
  for (const b of BRANDS) {
    if (b.names.some((n) => word(clean(n)).test(name)) && (b.alone || saysBeer || byBrewer)) {
      brand = b.slug;
      break;
    }
  }
  const isCider = /סיידר/.test(name) || brand === "somersby";
  if (!brand && !saysBeer && !isCider) return { verdict: "not_beer", beer: null, category: "", reason: "no beer word, no known brand" };
  for (const [re, reason] of NOT_A_BEER) if (re.test(name)) return { verdict: "not_beer", beer: null, category: "", reason };

  let category = "beer";
  let reason = brand ? "known brand" : "beer we do not carry";
  for (const [slug, re, why] of CATEGORY_RULES) {
    if (re.test(name)) {
      category = slug;
      reason = why;
      break;
    }
  }
  // Somersby makes cider only.
  if (brand === "somersby") [category, reason] = ["cider", "cider"];
  if (!IN_SCOPE.has(category)) return { verdict: "out_of_scope", beer: brand, category, reason };
  return { verdict: "beer", beer: brand, category, reason };
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
  // A returnable (חוזר, רב פעמי) is always a glass bottle; so is ח"פ (→ "חפ", חד-פעמי, one-way glass —
  // not פח, a can) and a "צוואר ארוך" long neck. "פחי" at the end is פחית cut at the length limit.
  const returnable = /רב פעמי|רב-פעמי|(^|\s)רב(\s|$)|חוזר|ב\.חוז/.test(name);
  const container = /פחית|פחיות|(^|\s)פח(\s|$|\d)|פחי$/.test(name)
    ? "can"
    : returnable || /בקבוק|בקבוקים|(^|\s)בק(\s|$|\d|\.)|בקב|(^|\s)חפ(\s|$|\d)|חד פעמי|צוו?אר/.test(name)
      ? "bottle"
      : null;

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
 * Who can redeem a promotion (migration 0014: conditions.audience). The feed's ClubID codes are, per the
 * government file spec: 0 all customers, 1 club members, 2 a credit card, 3 other conditions — but chains
 * label them inconsistently (Carrefour tags "מועדון קרפור אשראי" with 0). So an offer is for everyone
 * ONLY when every code is 0 and neither the label nor the description names a club, card, app, coupon,
 * employer or similar condition. In doubt, restricted: it is recorded, never shown or announced.
 *
 * @returns {{audience: "everyone"|"club"|"payment"|"coupon"|"personal"|"restricted", why: string}}
 */
export function audienceOf(promo) {
  const raw = String(promo.club_id_raw ?? "").trim();
  const text = clean(`${promo.description ?? ""} ${raw}`);
  const codes = [...raw.matchAll(/(?:^|[(|&"]\s*)(\d)\s*(?:=|-|$)|=\s*(\d)\s*["|)]/g)].map((m) => Number(m[1] ?? m[2]));
  if (/^\d$/.test(raw)) codes.push(Number(raw));
  const label = raw.replace(/^0\s*-\s*כלל הלקוחות$/, "");

  if (/עובד|עובדי|בעלים|סיטונא|עמותת|ארגון/.test(text)) return { audience: "personal", why: "employees, organisations or wholesale customers only" };
  if (/קופון|שובר|תווי|תו |מולטיפס/.test(text)) return { audience: "coupon", why: "needs a coupon or voucher" };
  if (codes.includes(2) || /אשראי|כרטיס|ישראכרט|ויזה|מאסטרקארד|דיינרס|אמריקן אקספרס|לאומי קארד|כאל|מקס(\s|$)/.test(text)) {
    return { audience: "payment", why: "needs a specific card or payment method" };
  }
  if (codes.includes(1) || promo.club_only || /מועדון|חברי|חבר /.test(text)) return { audience: "club", why: "club members only" };
  if (codes.includes(3) || /אפליקצי|אונליין|באתר|הזמנה אינטרנט|משלוח|online/i.test(text)) return { audience: "restricted", why: "restricted to some customers or channels" };
  if (codes.some((c) => c !== 0) || (label && !/^0$/.test(label) && !/כלל הלקוחות/.test(label))) return { audience: "restricted", why: `unrecognised eligibility "${raw}"` };
  return { audience: "everyone", why: "" };
}

/**
 * What a promotion says, conservatively. Two independent statements of its price exist:
 *   - the description, in forms we can state exactly: "2 ב 55" / "2ב71.40" (multi-buy: qty for total),
 *     "ב 24.90" or a lone "24.9" (a price cut);
 *   - the item's <DiscountedPrice> with its <MinQty> (the total paid for MinQty units — "2 ב 55" is
 *     MinQty 2, DiscountedPrice 55.00). The skill's parser drops this field for the dialect every chain
 *     uses, so lib/promo-supplement.mjs fills it in.
 * RewardType meanings are unsourced (the skill says so) and are not used. A promotion may be published
 * only when both statements exist and agree, and it is for everyone (`hold: false`); one statement
 * alone, a disagreement, per-item prices that differ, or any eligibility condition → HELD.
 *
 * Prices come back WITHOUT the bottle deposit, like shelf prices (Shufersal's "2ב71.40 פקדון" rows
 * publish DiscountedPrice 75.00 = 71.40 + 12 × ₪0.30; the description's 71.40 is kept, the deposit apart).
 *
 * @param {{description: string, club_only: boolean, club_id_raw?: string, items: Array<{item_code: string, min_qty?: string, discounted_price?: string}>}} promo
 * @param {Set<string> | null} [codes] the item codes the price is read for (e.g. only the beer rows); all when omitted
 * @returns {{kind: "multi_buy"|"price_cut"|"unmapped"|"excluded", qty?: number, total_agorot?: number,
 *            price_agorot?: number, audience: string, club: boolean, basis: string, hold: boolean, reason: string,
 *            depositInDescription: boolean}}
 */
export function readPromotion(promo, codes = null) {
  const text = clean(promo.description);
  const { audience, why: audienceWhy } = audienceOf(promo);
  const base = { audience, club: audience === "club", depositInDescription: false };
  const held = (kind, reason, extra = {}) => ({ kind, ...base, basis: "", hold: true, reason, ...extra });
  if (promo.items.length > 50) return held("excluded", `applies to ${promo.items.length} items — a store-wide coupon, not a beer offer`);
  if (/פיצוי|מתנה/.test(text)) return held("excluded", "compensation or gift, not a shelf offer");

  const said = fromDescription(text);
  const items = codes ? promo.items.filter((i) => codes.has(i.item_code)) : promo.items;
  const feed = fromFeed(items);
  const shape = (r) => (r.qty > 1 ? { kind: "multi_buy", qty: r.qty, total_agorot: r.total } : { kind: "price_cut", price_agorot: r.total });
  const show = (r) => (r.qty > 1 ? `${r.qty} for ₪${(r.total / 100).toFixed(2)}` : `₪${(r.total / 100).toFixed(2)}`);
  const restricted = audience === "everyone" ? "" : audienceWhy;
  const result = (r, basis, doubts = []) => {
    const reason = [restricted, ...doubts].filter(Boolean).join("; ");
    return { ...shape(r), ...base, basis, hold: Boolean(reason), reason };
  };

  if (feed?.varies) return held("unmapped", "the items' DiscountedPrice values differ");
  if (said && feed) {
    const gap = feed.total - said.total;
    if (said.qty === feed.qty && /פקדון/.test(text) && gap > 0 && gap % DEPOSIT_AGOROT === 0 && gap / DEPOSIT_AGOROT <= 48) {
      return { ...result(said, "description + DiscountedPrice"), depositInDescription: true, depositGap: gap };
    }
    if (said.qty !== feed.qty || said.total !== feed.total) return held("unmapped", `description says ${show(said)}, DiscountedPrice says ${show(feed)}`);
    return result(said, "description + DiscountedPrice");
  }
  if (said) return result(said, "description only", ["no DiscountedPrice to confirm it"]);
  if (feed) return result(feed, "DiscountedPrice only", ["the description states no price to confirm it"]);
  return held("unmapped", "no price in the description and no DiscountedPrice");
}

/** @returns {{qty: number, total: number} | null} */
function fromDescription(text) {
  // "2 ב 55", "2ב71.40", "2 יח ב 27.90", "2 יח ב-18 ש"ח"
  const multi = text.match(/(\d{1,2})\s*(?:יח|יחידות|פחיות|בקבוקים)?\s*ב\s*-?\s*(\d{1,4}(?:\.\d{1,2})?)(?!\d)/);
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
 * Several chains cut item names at about 20 characters ("גולדסטאר לא מסו", "בירה פאולנר בקבוק 50"). A
 * name that short may be LESS specific than another chain's full name for the same barcode, but it is
 * never evidence against it.
 */
export const TRUNCATION_LIMIT = 20;
// Without a name there is nothing to call truncated: the reading is taken at its word.
const isShort = (name) => typeof name === "string" && name.trim().length > 0 && name.trim().length <= TRUNCATION_LIMIT;
/** A beer another beer's name can be a shortened form of. */
const SHORTENS = { "tuborg-red": "tuborg" };

/**
 * One barcode is one product everywhere, so readings of the same GTIN must agree on the beer, the pack
 * and the container. Two things are allowed:
 *   - a reading that does not know the container takes it from one that does;
 *   - a reading from a SHORT (possibly truncated) name that is less specific — no variant, plain
 *     "beer" instead of non-alcoholic, "tuborg" instead of "tuborg-red" — takes the specific identity,
 *     provided every full-length name agrees with it.
 * Anything else (a full-length name saying something different, another volume or pack) means a name
 * was misread somewhere, and every reading of that barcode is held for a human.
 *
 * @param {Array<{code: string, chain?: string, retailer?: string, name?: string, beer: string, variant?: string, category?: string,
 *                container: string|null, volume_ml: number, pack_quantity: number}>} readings
 * @returns {Map<string, {agree: true, container: string|null, beer: string, variant: string, category: string} | {agree: false, why: string}>}
 */
export function reconcileBarcodes(readings) {
  const byCode = new Map();
  for (const r of readings) if (isGtin(r.code)) byCode.set(r.code, [...(byCode.get(r.code) ?? []), r]);
  const identity = (r) => ({ beer: r.beer, variant: r.variant ?? "", category: r.category ?? "beer" });
  const same = (a, b) => a.beer === b.beer && a.variant === b.variant && a.category === b.category;
  // Could `short` be a shortened reading of `full`?
  const shortens = (short, full) =>
    (short.beer === full.beer || SHORTENS[full.beer] === short.beer) &&
    (short.variant === "" || short.variant === full.variant) &&
    (short.category === "beer" || short.category === full.category);

  const result = new Map();
  for (const [code, rs] of byCode) {
    const seen = () => rs.map((r) => `${r.chain ?? r.retailer}: ${[r.beer, r.variant, r.category === "beer" ? "" : r.category].filter(Boolean).join(" ")} ${r.pack_quantity}×${r.volume_ml} ${r.container ?? ""}`.trim()).join(" / ");
    const shapes = new Set(rs.map((r) => `${r.pack_quantity}×${r.volume_ml}`));
    const containers = new Set(rs.map((r) => r.container).filter(Boolean));
    if (shapes.size > 1 || containers.size > 1) {
      result.set(code, { agree: false, why: `the same barcode reads differently — ${seen()}` });
      continue;
    }
    const full = rs.filter((r) => !isShort(r.name));
    const candidates = (full.length ? full : rs).map(identity);
    // The most specific identity among the readings that must be taken at their word.
    const target = candidates.find((c) => candidates.every((o) => same(o, c) || (full.length === 0 && shortens(o, c))));
    const ok = target && rs.every((r) => same(identity(r), target) || (isShort(r.name) && shortens(identity(r), target)));
    if (!ok) {
      result.set(code, { agree: false, why: `the same barcode reads differently — ${seen()}` });
      continue;
    }
    result.set(code, { agree: true, container: [...containers][0] ?? null, ...target });
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
