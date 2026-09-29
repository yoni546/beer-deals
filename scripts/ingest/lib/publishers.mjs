/**
 * Who publishes which feed, and which of OUR stores (retailers) each published branch belongs to.
 *
 * A feed's publisher is not always the retailer the shopper knows: Carrefour Israel's feed carries a
 * branch still trading as Yeinot Bitan; Dor Alon's feed carries its AM:PM convenience stores (and
 * Alonit, which the app does not list). The retailer is decided per BRANCH, from the publisher's own
 * Stores file (sub-chain name, store name) — never from the URL the file came from.
 *
 * Access routes follow the installed skill (.claude/skills/israeli-grocery-price-intelligence,
 * references/chain-feeds.md) and were each verified on 2026-09-29.
 */

/**
 * @typedef {{name?: string, subChainName?: string, subChain?: string|null, store: string}} FeedBranch
 * @typedef {{
 *   source: string, chainCode: string,
 *   platform: "carrefour"|"shufersal"|"cerberus"|"laib"|"bina"|"hatzi-hinam",
 *   code?: string, host?: string,
 *   retailer: (b: FeedBranch) => string | null,
 *   blocked?: string,
 * }} Publisher
 */

/** @type {Record<string, Publisher>} */
export const PUBLISHERS = {
  carrefour: {
    source: "feed-carrefour",
    chainCode: "7290055700007",
    platform: "carrefour",
    // One publisher for the Carrefour, Mega and Yeinot Bitan banners (the skill; confirmed in its Stores file).
    retailer: (b) => (/יינות\s*ביתן/.test(b.name ?? "") ? "yeinot-bitan" : "carrefour"),
  },
  shufersal: { source: "feed-shufersal", chainCode: "7290027600007", platform: "shufersal", retailer: () => "shufersal" },
  "rami-levy": { source: "feed-rami-levy", chainCode: "7290058140886", platform: "cerberus", code: "RamiLevi", retailer: () => "rami-levy" },
  yochananof: { source: "feed-yochananof", chainCode: "7290803800003", platform: "cerberus", code: "yohananof", retailer: () => "yochananof" },
  "osher-ad": { source: "feed-osher-ad", chainCode: "7290103152017", platform: "cerberus", code: "osherad", retailer: () => "osher-ad" },
  "tiv-taam": { source: "feed-tiv-taam", chainCode: "7290873255550", platform: "cerberus", code: "TivTaam", retailer: () => "tiv-taam" },
  "dor-alon": {
    source: "feed-dor-alon",
    chainCode: "7290492000005",
    platform: "cerberus",
    code: "doralon",
    // Dor Alon's sub-chains: AM:PM, Alonit mini-market, Alonit kiosk, kibbutz/moshav, HaMarket. Only AM:PM is ours.
    retailer: (b) => (/AM\s*:?\s*PM/i.test(b.subChainName ?? "") || /^am\s*-?\s*pm/i.test(b.name ?? "") ? "ampm" : null),
  },
  victory: { source: "feed-victory", chainCode: "7290696200003", platform: "laib", retailer: () => "victory" },
  mahsanei: { source: "feed-mahsanei", chainCode: "7290661400001", platform: "laib", retailer: () => "mahsanei" },
  "hatzi-hinam": { source: "feed-hatzi-hinam", chainCode: "7290700100008", platform: "hatzi-hinam", retailer: () => "hatzi-hinam" },
  "king-store": { source: "feed-king-store", chainCode: "7290058108879", platform: "bina", host: "kingstore.binaprojects.com", retailer: () => "king-store" },
  // 0.8.0: chains found on the same Cerberus portal (public account, empty password), verified 2026-09-29.
  keshet: { source: "feed-keshet", chainCode: "7290785400000", platform: "cerberus", code: "Keshet", retailer: () => "keshet-taamim" },
  freshmarket: {
    source: "feed-freshmarket",
    chainCode: "7290876100000",
    platform: "cerberus",
    code: "freshmarket",
    // The account also carries other banners (Hyper Dudu, Mahsanei Mazon): only branches named Fresh Market are ours.
    retailer: (b) => (/פרשמרקט|fresh\s*market/i.test(b.name ?? "") ? "fresh-market" : null),
  },
  "stop-market": { source: "feed-stop-market", chainCode: "7290639000004", platform: "cerberus", code: "Stop_Market", retailer: () => "stop-market" },
  politzer: { source: "feed-politzer", chainCode: "7291059100008", platform: "cerberus", code: "politzer", retailer: () => "politzer" },
  // Publishers that exist but cannot be read without credentials we do not have. Never guessed, never forced.
  "super-yuda": {
    source: "",
    chainCode: "7290058148776",
    platform: "cerberus",
    code: "yuda_ho",
    retailer: () => "super-yuda",
    blocked: "Super Yuda's Cerberus account (yuda_ho) requires a password; the public empty-password login is refused. Needs the chain's published credentials.",
  },
  "salach-dabach": {
    source: "",
    chainCode: "7290526500006",
    platform: "cerberus",
    code: "SalachD",
    retailer: () => "salach-dabach",
    blocked: "Salach Dabach's Cerberus account (SalachD) requires a password; the public empty-password login is refused.",
  },
  yellow: {
    source: "",
    chainCode: "7290644700005",
    platform: "cerberus",
    code: "Paz_bo",
    retailer: () => "yellow",
    blocked: "Paz Yellow's Cerberus account (Paz_bo) requires a password; the public empty-password login is refused.",
  },
};

/** Our stores that have no feed by design: they are categories, not chains. */
export const NO_FEED = { "liquor-store": "a category of independent shops, no single publisher", makolet: "a category of independent shops, no single publisher" };

/** Which publisher is authoritative for a (feed) chain code. */
export const publisherByChainCode = (code) => Object.entries(PUBLISHERS).find(([, p]) => p.chainCode === code)?.[0] ?? null;
