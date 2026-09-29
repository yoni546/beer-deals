import { describe, expect, it } from "vitest";
import { conditionChips, daysSince, packText, relativeTimeHe, validUntilHe, volumeHe } from "@/lib/format";
import { normalize, score, search, skeleton } from "@/lib/search";

// Thursday 2026-10-01 09:00 in Israel (UTC+3 in summer time → 06:00Z).
const NOW = Date.parse("2026-10-01T06:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("relative time in Hebrew", () => {
  it("speaks the way people do", () => {
    expect(relativeTimeHe(ago(20_000), NOW)).toBe("עכשיו");
    expect(relativeTimeHe(ago(MIN), NOW)).toBe("לפני דקה");
    expect(relativeTimeHe(ago(12 * MIN), NOW)).toBe("לפני 12 דקות");
    expect(relativeTimeHe(ago(HOUR), NOW)).toBe("לפני שעה");
    expect(relativeTimeHe(ago(2 * HOUR), NOW)).toBe("לפני שעתיים");
    expect(relativeTimeHe(ago(5 * HOUR), NOW)).toBe("לפני 5 שעות");
    expect(relativeTimeHe(ago(1 * DAY + 2 * HOUR), NOW)).toBe("אתמול");
    expect(relativeTimeHe(ago(2 * DAY), NOW)).toBe("לפני יומיים");
    expect(relativeTimeHe(ago(9 * DAY), NOW)).toBe("לפני 9 ימים");
  });

  it("counts days by the Israeli calendar, not by 24-hour blocks", () => {
    // 23:30 yesterday → 09:00 today is 9.5 hours but a different calendar day.
    expect(daysSince("2026-09-30T20:30:00Z", NOW)).toBe(1);
    expect(daysSince("2026-10-01T05:00:00Z", NOW)).toBe(0);
  });
});

describe("when a promotion ends", () => {
  it("says 'until end of today', 'until tomorrow', a weekday, or a date", () => {
    expect(validUntilHe("2026-10-01T20:00:00Z", NOW)).toBe("עד סוף היום"); // 23:00 Israel, same day
    expect(validUntilHe("2026-10-02T10:00:00Z", NOW)).toBe("עד מחר");
    expect(validUntilHe("2026-10-04T10:00:00Z", NOW)).toBe("עד יום א׳"); // Sunday
    expect(validUntilHe("2026-10-20T10:00:00Z", NOW)).toBe("עד 20.10");
  });

  it("has nothing to say when there is no end date, or it is over", () => {
    expect(validUntilHe(null, NOW)).toBeNull();
    expect(validUntilHe("2026-09-25T10:00:00Z", NOW)).toBeNull();
  });
});

describe("packs", () => {
  it("writes the pack like a shelf label", () => {
    const can = { volume_ml: 330, pack_quantity: 6, container: "can" as const, pack_label: "x" };
    expect(packText(can)).toBe("6 × 330 מ״ל · פחית");
    expect(packText({ ...can, pack_quantity: 1, container: "bottle" })).toBe("330 מ״ל · בקבוק");
    expect(packText({ ...can, volume_ml: 1500, pack_quantity: 1 })).toBe("1.5 ל׳ · פחית");
    expect(packText({ volume_ml: null, pack_quantity: null, container: null, pack_label: "שישייה" })).toBe("שישייה");
  });

  it("formats volumes", () => {
    expect(volumeHe(330)).toBe("330 מ״ל");
    expect(volumeHe(1000)).toBe("1 ל׳");
    expect(volumeHe(1500)).toBe("1.5 ל׳");
  });
});

describe("promotion terms as chips", () => {
  it("shows a multi-buy, a club condition and limits", () => {
    expect(conditionChips({ promo_type: "multi_buy", conditions: { multi_buy: { qty: 2, total_agorot: 4500 } } })).toEqual([{ label: "2 ב־₪45", kind: "multi" }]);
    expect(conditionChips({ promo_type: "multi_buy", conditions: { multi_buy: { qty: 3, total_agorot: 10050 } } })[0].label).toBe("3 ב־₪100.50");
    expect(conditionChips({ promo_type: "club_price", conditions: { club: "שופרסל פלוס" } })).toEqual([{ label: "חברי שופרסל פלוס", kind: "club" }]);
    expect(conditionChips({ promo_type: "club_price", conditions: {} })[0].label).toBe("חברי מועדון");
    expect(conditionChips({ promo_type: "price_cut", conditions: { max_qty: 6 } })).toEqual([{ label: "עד 6 ליחידות", kind: "limit" }]);
    expect(conditionChips({ promo_type: "price_cut", conditions: {} })).toEqual([]);
  });
});

describe("normalising text for search", () => {
  it("folds niqqud, quotes, punctuation, final letters and case", () => {
    expect(normalize("גּוֹלְדסְטָאר")).toBe("גולדסטאר");
    expect(normalize("Beck's")).toBe("becks");
    expect(normalize("AM:PM")).toBe("am pm");
    expect(normalize("  שופר-סל  ")).toBe("שופר סל");
    expect(normalize("ארגז")).toBe(normalize("ארגז"));
    expect(normalize("קרפור")).toBe("קרפור");
    expect(normalize("סופר")).toBe("סופר");
    expect(normalize("ך")).toBe("כ"); // final kaf → kaf
  });

  it("makes spelling variants meet on their consonant skeleton", () => {
    expect(skeleton("גולדסטאר")).toBe(skeleton("גולדסטר"));
    expect(skeleton("היינקן")).toBe(skeleton("היניקן"));
  });
});

describe("searching", () => {
  const beers = [
    { slug: "goldstar", he: "גולדסטאר", en: "Goldstar" },
    { slug: "maccabee", he: "מכבי", en: "Maccabee" },
    { slug: "heineken", he: "היינקן", en: "Heineken" },
    { slug: "tuborg", he: "טובורג", en: "Tuborg" },
    { slug: "tuborg-red", he: "טובורג אדום", en: "Tuborg Red" },
    { slug: "becks", he: "בקס", en: "Beck's" },
    { slug: "somersby", he: "סאמרסבי", en: "Somersby" },
  ];
  const texts = (b: (typeof beers)[number]) => [b.he, b.en];
  const find = (q: string) => search(beers, q, texts).map((b) => b.slug);

  it("finds a beer by Hebrew or English, from the first letters", () => {
    expect(find("גול")[0]).toBe("goldstar");
    expect(find("gold")[0]).toBe("goldstar");
    expect(find("מכ")).toEqual(["maccabee"]);
    expect(find("becks")).toEqual(["becks"]);
    expect(find("beck's")).toEqual(["becks"]);
  });

  it("forgives the usual Hebrew spelling variants and a single typo", () => {
    expect(find("גולדסטר")[0]).toBe("goldstar"); // no alef
    expect(find("היניקן")[0]).toBe("heineken"); // yod in a different place
    expect(find("goldstr")[0]).toBe("goldstar");
    expect(find("hieneken")[0]).toBe("heineken"); // two neighbouring letters swapped
  });

  it("ranks the exact and prefix matches above the looser ones", () => {
    expect(find("טובורג")).toEqual(["tuborg", "tuborg-red"]); // exact before the longer name
    expect(find("red")).toEqual(["tuborg-red"]);
  });

  it("returns everything for an empty query, and nothing for nonsense", () => {
    expect(find("")).toHaveLength(beers.length);
    expect(find("   ")).toHaveLength(beers.length);
    expect(find("zzzzqq")).toEqual([]);
  });

  it("scores exact above prefix above substring", () => {
    expect(score("מכבי", ["מכבי"])).toBeGreaterThan(score("מכ", ["מכבי"]));
    expect(score("מכ", ["מכבי"])).toBeGreaterThan(score("כבי", ["מכבי"]));
    expect(score("כבי", ["מכבי"])).toBeGreaterThan(0);
    expect(score("xyz", ["מכבי"])).toBe(0);
  });

  it("finds a chain despite punctuation", () => {
    const stores = ["AM:PM", "שופרסל", "רמי לוי", "יינות ביתן", "חצי חינם"];
    expect(search(stores, "ampm", (s) => [s])).toEqual(["AM:PM"]);
    expect(search(stores, "רמי", (s) => [s])).toEqual(["רמי לוי"]);
    expect(search(stores, "ביתן", (s) => [s])).toEqual(["יינות ביתן"]);
  });
});
