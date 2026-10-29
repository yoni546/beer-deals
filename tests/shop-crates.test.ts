import { describe, expect, it } from "vitest";
import { countOf, readCrate, readEliasi, readWinehouse } from "../scripts/shops/lib/crates.mjs";
import { BRANDS } from "../scripts/ingest/lib/normalize.mjs";
import { asUser } from "./helpers/db";
import { world } from "./helpers/catalog";
import { crateText, perUnitAgorot } from "@/lib/shops";

/**
 * Crate prices on liquor shops' websites (0068, scripts/shops/).
 *
 * The excerpts are the shops' own markup and titles as they were on 2026-10-30, cut down to what is read.
 */
const known = new Set((BRANDS as Array<{ slug: string }>).map((b) => b.slug));

const eliasiBlock = (title: string, price: string, ribbon: string, capacity: string, extra = "") => `
<div class="products__block products__block_cat"
  data-filter-3-extra-capacity-txt="${capacity}"
  data-sort-price="${price}">
<div class="products__block_inner">${extra}
  <a class="products__info products__info_has_note" href="/Goldstar-Can-500ml-24-pack">
    <div class="product-note-ribbon">${ribbon}</div>
    <div class="products__title"><div class="products__title_inner"><p>${title}</p></div></div>
  </a>
</div></div>`;

describe("reading a shop's page", () => {
  it("reads Eliasi's crate blocks: title, price, count, size, stock", () => {
    const html =
      "<html>" +
      eliasiBlock("ארגז בירה גולדסטאר פחית 500 מל&#039;", "165", "24 יח&#039;", "500 מל&#039;") +
      eliasiBlock("ארגז בירה קורונה פחית 330 מל&#039;- אזל מהמלאי", "119.9", "", "330 מל&#039;", '<div class="ribbon-box"><span>אין במלאי</span></div>');
    const rows = readEliasi(html);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ title: "ארגז בירה גולדסטאר פחית 500 מל'", price: 165, inStock: true, url: "https://www.eliasi.co.il/Goldstar-Can-500ml-24-pack" });
    expect(rows[0].text).toBe("24 יח' 500 מל'");
    // The stock is not part of the name.
    expect(rows[1]).toMatchObject({ title: "ארגז בירה קורונה פחית 330 מל'", inStock: false });
  });

  it("reads Beit HaYayin's Store API rows, with the pack sentence from the description", () => {
    const rows = readWinehouse([
      {
        name: "ארגז בירה באדוויזר",
        permalink: "https://winehouse.co.il/product/%d7%90%d7%a8%d7%92%d7%96/",
        is_in_stock: true,
        prices: { price: "130", currency_minor_unit: 0 },
        short_description: "<p>מותג הבירה הגדול בעולם, נולד בשנת 1876. 5% אלכוהול.</p><p>ארגז בירה באדוויזר- 24 בקבוקים של 330 מ״ל.</p><p><strong>מוצר באיסוף עצמי בלבד!</strong></p>",
      },
    ]);
    expect(rows[0]).toMatchObject({ price: 130, inStock: true, pickupOnly: true, url: "https://winehouse.co.il/product/ארגז/" });
    // The year and the percentage in the copy are not read as a size.
    expect(rows[0].text).toMatch(/24 בקבוקים של 330/);
    expect(rows[0].text).not.toMatch(/1876/);
  });
});

describe("a shop's title becomes a crate of one of our beers", () => {
  const crate = (title: string, text = "", price = 150) => readCrate({ title, text, price }, known);

  it("reads the beer, the variant, the count and the size", () => {
    expect(crate("ארגז בירה גולדסטאר פחית 500 מל'", "24 יח' 500 מל'", 165)).toEqual({
      ok: true,
      crate: { beer: "goldstar", variant: "", pack_quantity: 24, volume_ml: 500, container: "can", price_agorot: 16500 },
    });
    expect(crate("ארגז בירה גולדסטאר לא מסונן 330 מל'", "24 בק' 330 מל'").crate).toMatchObject({ beer: "goldstar", variant: "לא מסונן", pack_quantity: 24, container: "bottle" });
    expect(crate("ארגז בירה פאולנר 500 מל'", "20 יח' 500 מל'").crate).toMatchObject({ beer: "paulaner", pack_quantity: 20, volume_ml: 500 });
  });

  it("knows a beer on a crate page even when the title does not say 'בירה'", () => {
    expect(crate("מארז מכבי 24 פחיות").crate).toMatchObject({ beer: "maccabee", pack_quantity: 24, container: "can" });
    expect(crate("באדוייזר 24 פחיות").crate).toMatchObject({ beer: "budweiser" });
    expect(crate("מארז גולדסטאר אנפילטרד 24 יח'").crate).toMatchObject({ beer: "goldstar", variant: "לא מסונן" });
  });

  it("never assumes a crate holds 24", () => {
    expect(crate("ארגז בירה דובדבנים קסטיל רוז", "330 מל'")).toEqual({ ok: false, reason: "no count on the page (never assumed to be 24)" });
  });

  it("refuses a six-pack, a beer we do not carry, and a price that is not a crate's", () => {
    expect(crate("שישיית בירה גולדסטאר", "6 יח' 330 מל'").ok).toBe(false);
    expect(crate("ארגז בירה שקמה IPA", "24 בק' 330 מל'")).toMatchObject({ ok: false, reason: "not one of our beers" });
    expect(crate("ארגז בירה גולדסטאר 330 מל'", "24 יח'", 12)).toMatchObject({ ok: false });
  });

  it("reads the count the way the shops write it", () => {
    expect(countOf("24 יח' 500 מל'")).toBe(24);
    expect(countOf("20 בק' 500 מל'")).toBe(20);
    expect(countOf("כולל 24 פחיות של בירה")).toBe(24);
    // A percentage or a size is not a count.
    expect(countOf("גולדסטאר 10% פחית")).toBeNull();
    expect(countOf("330 מל'")).toBeNull();
  });

  it("words the pack and the price per bottle without inventing either", () => {
    expect(crateText({ pack_quantity: 24, volume_ml: 500, container: "can", variant: "" })).toBe("24 × 500 מ״ל · פחיות");
    expect(crateText({ pack_quantity: 24, volume_ml: null, container: null, variant: "לא מסונן" })).toBe("לא מסונן · 24 יח׳");
    expect(perUnitAgorot({ price_agorot: 16500, pack_quantity: 24 })).toBe(688);
  });
});

describe("who may read and write shop_crate_prices", () => {
  const row = (beerId: string) => [beerId, "ארגז בירה גולדסטאר פחית 500 מל'", 24, 500, "can", 16500, "https://www.eliasi.co.il/Goldstar-Can-500ml-24-pack"];
  const insert =
    "insert into public.shop_crate_prices (shop, beer_id, title, pack_quantity, volume_ml, container, price_agorot, url) values ('eliasi', $1, $2, $3, $4, $5, $6, $7)";

  it("the daily import (service role) writes; anybody reads", async () => {
    const w = await world();
    await asUser(w.db, null, () => w.db.query(insert, row(w.ids.goldstar)), "service_role");
    const anon = await asUser(w.db, null, () => w.db.query("select price_agorot from public.shop_crate_prices"), "anon");
    expect(anon.rows).toEqual([{ price_agorot: 16500 }]);
  });

  it("nobody else writes, an admin included", async () => {
    const w = await world();
    await expect(asUser(w.db, w.visitor, () => w.db.query(insert, row(w.ids.goldstar)))).rejects.toThrow();
    await expect(asUser(w.db, w.admin, () => w.db.query(insert, row(w.ids.goldstar)))).rejects.toThrow();
    await expect(asUser(w.db, null, () => w.db.query(insert, row(w.ids.goldstar)), "anon")).rejects.toThrow();
  });

  it("refuses what cannot be a crate price", async () => {
    const w = await world();
    const service = (values: unknown[]) => asUser(w.db, null, () => w.db.query(insert, values), "service_role");
    const ok = row(w.ids.goldstar);
    await expect(service([...ok.slice(0, 5), 1200, ok[6]])).rejects.toThrow(/check/); // ₪12
    await expect(service([...ok.slice(0, 2), 6, ...ok.slice(3)])).rejects.toThrow(/check/); // a six-pack
    await expect(service([...ok.slice(0, 6), "http://insecure.example/x"])).rejects.toThrow(/check/);
  });
});
