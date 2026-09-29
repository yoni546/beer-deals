import { describe, expect, it } from "vitest";
import { discountPercent, formatAgorot, formatPrice, shekelsToAgorot } from "@/lib/money";
import { parseCategory } from "@/lib/categories";

describe("shekelsToAgorot", () => {
  it("parses the prices people actually type", () => {
    expect(shekelsToAgorot("24.90")).toBe(2490);
    expect(shekelsToAgorot("24.9")).toBe(2490);
    expect(shekelsToAgorot("24")).toBe(2400);
    expect(shekelsToAgorot(" 24.90 ")).toBe(2490);
    expect(shekelsToAgorot("₪24.90")).toBe(2490);
    expect(shekelsToAgorot("0.90")).toBe(90);
    // A comma is a decimal separator here, not a thousands separator.
    expect(shekelsToAgorot("24,90")).toBe(2490);
  });

  it("does not go through a float", () => {
    // parseFloat("19.99") * 100 is 1998.9999999999998. Every one of these is a
    // price that would round wrong if the arithmetic happened on the number.
    expect(shekelsToAgorot("19.99")).toBe(1999);
    expect(shekelsToAgorot("8.29")).toBe(829);
    expect(shekelsToAgorot("1.15")).toBe(115);
    expect(shekelsToAgorot("109.11")).toBe(10911);
  });

  it("rejects what is not a price", () => {
    expect(shekelsToAgorot("")).toBeNull();
    expect(shekelsToAgorot("abc")).toBeNull();
    expect(shekelsToAgorot("-5")).toBeNull();
    expect(shekelsToAgorot("24.900")).toBeNull();
    // Ambiguous, so refused rather than guessed: this is a price.
    expect(shekelsToAgorot("1,299")).toBeNull();
  });
});

describe("formatting", () => {
  it("always shows two decimals", () => {
    expect(formatAgorot(2490)).toBe("24.90");
    expect(formatAgorot(2400)).toBe("24.00");
    expect(formatAgorot(90)).toBe("0.90");
    expect(formatAgorot(5)).toBe("0.05");
    expect(formatPrice(2490)).toBe("₪24.90");
  });

  it("round-trips", () => {
    for (const input of ["24.90", "0.05", "199.99", "7"]) {
      const agorot = shekelsToAgorot(input);
      expect(agorot).not.toBeNull();
      expect(shekelsToAgorot(formatAgorot(agorot as number))).toBe(agorot);
    }
  });
});

describe("discountPercent", () => {
  it("matches the generated column in Postgres", () => {
    expect(discountPercent(2490, 3990)).toBe(38);
    expect(discountPercent(2990, 3990)).toBe(25);
    expect(discountPercent(3290, 3990)).toBe(18);
  });

  it("refuses to describe a non-discount", () => {
    expect(discountPercent(3990, 3990)).toBeNull();
    expect(discountPercent(4990, 3990)).toBeNull();
    expect(discountPercent(2490, 0)).toBeNull();
  });
});

describe("parseCategory", () => {
  it("falls back to a single category rather than to everything", () => {
    // A mixed list would be sorted by a price that means three different
    // things, so an unknown value must not open the gates.
    expect(parseCategory(undefined)).toBe("sixpack");
    expect(parseCategory("all")).toBe("sixpack");
    expect(parseCategory("case")).toBe("case");
    expect(parseCategory("single")).toBe("single");
  });
});
