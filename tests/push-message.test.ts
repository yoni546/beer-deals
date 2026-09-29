import { describe, expect, it } from "vitest";
import type { Offer } from "@/lib/db/types";
import { buildBeerPath, buildOfferNotification, buildTestNotification } from "@/lib/push/message";

function offer(overrides: Partial<Offer> = {}): Offer {
  return {
    offer_key: "obs:7", origin: "catalog", sku_id: "sku-1",
    beer_id: "b-goldstar", beer_slug: "goldstar", beer_name: "גולדסטאר",
    store_id: "s-rami", store_slug: "rami-levy", store_name: "רמי לוי",
    pack_label: "גולדסטאר 6×330 מ״ל פחית", container: "can", volume_ml: 330, pack_quantity: 6,
    effective_agorot: 2500, unit_price_per_liter_agorot: 1263,
    reference_agorot: 3790, reference_trust: "moderated", value_pct: 34, needs_review: false,
    market_reference_agorot: null, market_value_pct: null, promo_type: "price_cut", conditions: {},
    valid_from: null, valid_to: null, observed_at: "2026-09-29T08:00:00Z", is_sample: false, notes: null,
    ...overrides,
  };
}

describe("the notification text (audit §13.3)", () => {
  it("names the chain, the pack, the price, and the saving — and where it came from", () => {
    const message = buildOfferNotification(offer());
    expect(message.title).toBe("מבצע חדש ברמי לוי");
    expect(message.body).toBe("גולדסטאר שישייה · 6×330 מ״ל · פחית · ₪25.00 במקום ₪37.90 · −34%");
  });

  it("says nothing about a saving it cannot vouch for", () => {
    const message = buildOfferNotification(offer({ value_pct: null, reference_agorot: null, reference_trust: null }));
    expect(message.body).toBe("גולדסטאר שישייה · 6×330 מ״ל · פחית · ₪25.00");
    expect(message.body).not.toMatch(/במקום|%/);
  });

  it("states a multi-buy's terms instead of an 'instead of' price", () => {
    const message = buildOfferNotification(
      offer({ effective_agorot: 4000, promo_type: "multi_buy", conditions: { multi_buy: { qty: 2, total_agorot: 8000 } }, value_pct: 20, reference_agorot: 4990 }),
    );
    expect(message.body).toBe("גולדסטאר שישייה · 6×330 מ״ל · פחית · 2 ב־₪80.00 · −20%");
    expect(message.body).not.toContain("במקום");
  });

  it("never words an offer as members-only: such offers are not announced at all (0014)", () => {
    const message = buildOfferNotification(offer({ promo_type: "club_price", conditions: { club: "שופרסל פלוס" } }));
    expect(message.body).not.toMatch(/חברי|מועדון/);
  });

  it("puts the chain after ב, with a maqaf for a Latin name", () => {
    expect(buildOfferNotification(offer({ store_name: "יוחננוף" })).title).toBe("מבצע חדש ביוחננוף");
    expect(buildOfferNotification(offer({ store_name: "AM:PM" })).title).toBe("מבצע חדש ב־AM:PM");
  });

  it("handles a legacy deal that only knows a category, not a volume", () => {
    const message = buildOfferNotification(offer({ origin: "legacy", sku_id: null, volume_ml: null, pack_quantity: null, container: null, pack_label: "שישייה" }));
    expect(message.body).toBe("גולדסטאר שישייה · ₪25.00 במקום ₪37.90 · −34%");
  });

  it("opens the beer's page by slug, and collapses repeats per pack and chain", () => {
    const message = buildOfferNotification(offer());
    expect(message.url).toBe("/beer/goldstar");
    expect(message.tag).toBe("offer:sku-1:rami-levy");
    expect(buildOfferNotification(offer({ sku_id: null })).tag).toBe("offer:b-goldstar:rami-levy");
  });

  it("carries no emoji and no undefined, whatever is missing", () => {
    const text = JSON.stringify([buildOfferNotification(offer()), buildOfferNotification(offer({ value_pct: null, reference_agorot: null })), buildTestNotification()]);
    expect(text).not.toMatch(/undefined|null/);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("where a tap goes", () => {
  it("is /beer/<slug>, escaped, and never a database id", () => {
    expect(buildBeerPath({ beerSlug: "goldstar" })).toBe("/beer/goldstar");
    expect(buildBeerPath({ beerSlug: "a b/c" })).toBe("/beer/a%20b%2Fc");
  });
});
