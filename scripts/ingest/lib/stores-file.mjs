/**
 * Reads a publisher's Stores / StoresFull file into branches. (The skill's parser covers prices and
 * promotions only; a Stores file is a flat list, read here.) The skill warns that encoding is not
 * reliably UTF-8 — a live Carrefour Stores file was UTF-16LE with a BOM — so the BOM is sniffed.
 */
import { gunzipSync } from "node:zlib";

export function decode(buf) {
  const raw = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf;
  if (raw[0] === 0xff && raw[1] === 0xfe) return raw.subarray(2).toString("utf16le");
  if (raw[0] === 0xfe && raw[1] === 0xff) return Buffer.from(raw.subarray(2)).swap16().toString("utf16le");
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) return raw.subarray(3).toString("utf8");
  // UTF-16 without a BOM: every other byte of ASCII markup is zero.
  if (raw.length > 4 && raw[1] === 0 && raw[3] === 0) return raw.toString("utf16le");
  return raw.toString("utf8");
}

const tag = (block, name) => (block.match(new RegExp(`<${name}>([^<]*)</${name}>`, "i")) ?? [])[1]?.replace(/\s+/g, " ").trim() ?? "";

/**
 * @returns {Array<{chain: string, subChain: string, subChainName: string, store: string, name: string, address: string, city: string}>}
 */
export function parseStores(buf) {
  const xml = decode(buf);
  const chain = tag(xml, "ChainId") || tag(xml, "ChainID") || tag(xml, "CHAINID");
  const out = [];
  // Two layouts: <SubChain> blocks containing <Store>s (Carrefour, Shufersal), or flat <Store>s each
  // carrying its own sub-chain fields (Cerberus, Laibcatalog, Bina).
  const subBlocks = [...xml.matchAll(/<SubChain>([\s\S]*?)<\/SubChain>/gi)].map((m) => m[1]);
  const groups = subBlocks.length ? subBlocks : [xml];
  for (const group of groups) {
    const subChain = tag(group, "SubChainId") || tag(group, "SubChainID");
    const subChainName = tag(group, "SubChainName");
    for (const [, store] of group.matchAll(/<(?:Store|STORE)>([\s\S]*?)<\/(?:Store|STORE)>/g)) {
      out.push({
        chain: tag(store, "ChainId") || tag(store, "ChainID") || chain,
        subChain: tag(store, "SubChainId") || tag(store, "SubChainID") || subChain,
        subChainName: tag(store, "SubChainName") || subChainName,
        store: tag(store, "StoreId") || tag(store, "StoreID") || tag(store, "STOREID"),
        name: tag(store, "StoreName") || tag(store, "STORENAME"),
        address: tag(store, "Address") || tag(store, "ADDRESS"),
        city: tag(store, "City") || tag(store, "CITY"),
      });
    }
  }
  return out.filter((s) => s.store);
}

/** Store codes are zero-padded differently across files ("2", "002", "0002"). */
export const sameStore = (a, b) => String(Number(a)) === String(Number(b));
