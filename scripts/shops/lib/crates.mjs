/**
 * Crate prices on liquor shops' websites (migration 0068): how each shop's page is read, and how a
 * shop's own product title becomes one of our beers and a pack. Pure functions apart from `fetchShop`;
 * the reading rules are the import's own (scripts/ingest/lib/normalize.mjs), so a crate is a beer here
 * exactly when it would be one in a chain's price file.
 *
 * WHICH SHOPS, AND WHY THESE. The owner chose (2026-10-30) the two whose terms do not forbid reading
 * their pages: אליאסי משקאות (robots.txt allows everything, no clause on automated access) and בית היין
 * (WooCommerce, robots allows everything, terms silent). Others are to be asked first. Nothing here logs
 * in, submits anything, or goes past a bot check; one request per shop per day.
 *
 * NEVER A GUESSED PACK. A title that says ארגז / מגש / מארז without a count is not read as 24: crates hold
 * 12, 20 or 24, and a wrong count is a wrong price per bottle. Such a row is reported and skipped.
 */
import { classify, clean, parsePack, variantOf } from "../../ingest/lib/normalize.mjs";

const UA = "beer-deals/1.0 (+https://github.com/yoni546/beer-deals)";

export const SHOPS = {
  eliasi: { name: "אליאסי משקאות", origin: "https://www.eliasi.co.il", page: "/beers-cases" },
  winehouse: { name: "בית היין", origin: "https://winehouse.co.il", api: "/wp-json/wc/store/v1/products?category=394&per_page=100" },
};

const decode = (text) =>
  String(text ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#0?39;|&#8217;|&#8221;|&quot;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

/**
 * Eliasi's crate category is one server-rendered page listing every crate (45 on 2026-10-30), each in a
 * `products__block_cat` block: the price in data-sort-price, the size in the capacity filter, the count on
 * the ribbon ("24 יח'"), and "אין במלאי" / "אזל" when it is out of stock.
 * @returns {Array<{title: string, text: string, price: number, url: string, inStock: boolean, pickupOnly: boolean}>}
 */
export function readEliasi(html) {
  return html
    .split('<div class="products__block products__block_cat"')
    .slice(1)
    .map((block) => {
      // "…- אזל מהמלאי" is the stock, not the name.
      const title = decode((block.match(/<div class="products__title_inner">\s*<p>([\s\S]*?)<\/p>/) ?? [])[1]).replace(/\s*-\s*אזל מהמלאי\s*$/, "");
      const href = (block.match(/<a class="products__info[^"]*"\s+href="([^"]+)"/) ?? [])[1];
      const price = Number((block.match(/data-sort-price="([\d.]+)"/) ?? [])[1]);
      const capacity = decode((block.match(/data-filter-3-extra-capacity-txt="([^"]*)"/) ?? [])[1]);
      const ribbon = decode((block.match(/<div class="product-note-ribbon">([\s\S]*?)<\/div>/) ?? [])[1]);
      return {
        title,
        text: [ribbon, capacity].filter(Boolean).join(" "),
        price,
        url: href ? new URL(href, SHOPS.eliasi.origin).href : "",
        inStock: !/אין במלאי|אזל מהמלאי/.test(block),
        pickupOnly: /איסוף עצמי בלבד/.test(block),
      };
    })
    .filter((row) => row.title && row.url && row.price > 0);
}

/** Beit HaYayin's crates through the WooCommerce Store API (category 394, "ארגזי בירה"). */
export function readWinehouse(products) {
  return products.map((p) => {
    const minor = Number(p.prices?.currency_minor_unit ?? 2);
    const description = decode(p.short_description || p.description);
    return {
      title: decode(p.name),
      // Only the sentence that states the pack ("24 בקבוקים של 330 מ״ל"): the rest is marketing copy, and
      // a year or a percentage in it must not be read as a size.
      text: (description.match(/[^.!]*\d{2}\s*(?:בקבוקים|פחיות|יח)[^.!]*/) ?? [""])[0],
      price: Number(p.prices?.price) / 10 ** minor,
      url: decodeURI(p.permalink ?? ""),
      inStock: p.is_in_stock !== false,
      pickupOnly: /איסוף עצמי בלבד/.test(description),
    };
  });
}

/**
 * One row of a shop's page → a crate of one of our beers, or the reason it is not.
 * @param {{title: string, text: string, price: number}} row
 * @param {Set<string>} known our beer slugs
 */
export function readCrate(row, known) {
  // Both pages are beer-crate categories, so every title is a beer even when it does not say so ("מארז מכבי
  // 24 פחיות"), and the shops spell a few brands their own way.
  const title = spelled(row.title);
  const kind = classify({ item_name: `בירה ${title}`, manufacturer: "", price: row.price });
  if (kind.verdict !== "beer") return { ok: false, reason: `${kind.verdict}: ${kind.reason}` };
  if (!kind.beer || !known.has(kind.beer)) return { ok: false, reason: "not one of our beers" };

  // The title first, then the pack sentence: "ארגז בירה גולדסטאר פחית 500 מל" + "24 יח".
  const both = `${title} ${row.text}`;
  const pack = parsePack({ item_name: both, quantity: "", unit_of_measure: "" });
  const count = countOf(both) ?? (Number.isFinite(pack.pack_quantity) ? pack.pack_quantity : null);
  if (!count) return { ok: false, reason: "no count on the page (never assumed to be 24)" };
  if (count < 10) return { ok: false, reason: `a ${count}-pack, not a crate` };
  if (count > 48) return { ok: false, reason: `count ${count} is not a crate` };

  const agorot = Math.round(row.price * 100);
  if (!(agorot >= 2000 && agorot <= 100000)) return { ok: false, reason: `price ₪${row.price} is not a crate price` };

  return {
    ok: true,
    crate: {
      beer: kind.beer,
      variant: variantOf(kind.beer, clean(title), kind.category).variant,
      pack_quantity: count,
      volume_ml: pack.volume_ml,
      container: pack.container,
      price_agorot: agorot,
    },
  };
}

/** The shops' own spellings of brands the catalogue writes differently. */
const SPELLINGS = [
  [/באדווייזר|באדוייזר/g, "באדוויזר"],
  [/קרומבכאר/g, "קרומבכר"],
  // "אנפילטרד" is Goldstar Unfiltered, which the catalogue calls "לא מסונן".
  [/אנפילטרד/g, "לא מסונן"],
];
const spelled = (title) => SPELLINGS.reduce((text, [re, to]) => text.replace(re, to), title);

/**
 * The count a shop writes: "24 יח'", "20 בק'", "24 פחיות", "24 בקבוקים". (The import's parsePack reads the
 * number from the wrong group for these — tracked separately; here it is read directly.)
 */
export function countOf(text) {
  const m = clean(text).match(/(^|[^\d.])(\d{1,2})\s*(יחידות|יח|בקבוקים|בקבוקי|בק|פחיות)(?=[\s.,\-]|$)/);
  return m ? Number(m[2]) : null;
}

/** Fetch one shop's page and return its rows (the only I/O here). */
export async function fetchShop(slug) {
  const shop = SHOPS[slug];
  const res = await fetch(shop.origin + (shop.api ?? shop.page), { headers: { "user-agent": UA, accept: shop.api ? "application/json" : "text/html" } });
  if (!res.ok) throw new Error(`${slug}: HTTP ${res.status}`);
  return slug === "eliasi" ? readEliasi(await res.text()) : readWinehouse(await res.json());
}
