import { describe, expect, it } from "vitest";
import {
  decide,
  eventVerdict,
  israelDayStart,
  israelHour,
  isQuietHour,
  type NotifySettings,
  type PushOffer,
  type PushRecipient,
} from "@/lib/push/rules";

const settings: NotifySettings = { minValuePct: 25, maxPriceAgorot: 3000, cooldownHours: 20, dailyCap: 2, quietStart: 22, quietEnd: 8 };
const offer: PushOffer = { beerId: "goldstar", priceAgorot: 2500, valuePct: 34 };
const person: PushRecipient = { userId: "u1", primaryBeerId: "goldstar", notificationsEnabled: true, subscriptions: 1, lastSentForBeerAt: null, sentToday: 0 };

// 2026-09-29 is in Israel summer time (UTC+3). 12:00 UTC = 15:00 in Israel.
const afternoon = new Date("2026-09-29T12:00:00Z");
const later = new Date("2026-09-30T00:00:00Z"); // 03:00 the next day in Israel
const inOneDay = new Date("2026-09-30T12:00:00Z");

describe("event-level rules (the same for everyone)", () => {
  it("passes a verified saving that clears both thresholds", () => {
    expect(eventVerdict(offer, settings, afternoon, inOneDay)).toEqual({ ok: true });
  });

  it("says nothing when there is no verified saving, however cheap the price looks", () => {
    expect(eventVerdict({ ...offer, valuePct: null, priceAgorot: 100 }, settings, afternoon, inOneDay)).toEqual({ ok: false, reason: "no_verified_saving" });
  });

  it("needs the saving to reach the minimum, and the price to be under the cap — both", () => {
    expect(eventVerdict({ ...offer, valuePct: 24 }, settings, afternoon, inOneDay)).toEqual({ ok: false, reason: "below_threshold" });
    expect(eventVerdict({ ...offer, valuePct: 25 }, settings, afternoon, inOneDay)).toEqual({ ok: true }); // the minimum itself counts
    expect(eventVerdict({ ...offer, valuePct: 60, priceAgorot: 3001 }, settings, afternoon, inOneDay)).toEqual({ ok: false, reason: "over_price_cap" });
    expect(eventVerdict({ ...offer, priceAgorot: 3000 }, settings, afternoon, inOneDay)).toEqual({ ok: true }); // the cap itself counts
  });

  it("does not announce a deal that has ended", () => {
    expect(eventVerdict(offer, settings, inOneDay, inOneDay)).toEqual({ ok: false, reason: "expired" });
    expect(eventVerdict(offer, settings, new Date(inOneDay.getTime() + 1), inOneDay)).toEqual({ ok: false, reason: "expired" });
  });
});

describe("person-level rules", () => {
  it("sends to someone whose number-one beer this is", () => {
    expect(decide(offer, person, settings, afternoon)).toEqual({ action: "send" });
  });

  it("never interrupts for favourites #2–#4 (they are simply not the primary beer)", () => {
    expect(decide(offer, { ...person, primaryBeerId: "maccabee" }, settings, afternoon)).toEqual({ action: "skip", reason: "not_primary" });
    expect(decide(offer, { ...person, primaryBeerId: null }, settings, afternoon)).toEqual({ action: "skip", reason: "not_primary" });
  });

  it("respects the switch and needs a device", () => {
    expect(decide(offer, { ...person, notificationsEnabled: false }, settings, afternoon)).toEqual({ action: "skip", reason: "disabled" });
    expect(decide(offer, { ...person, subscriptions: 0 }, settings, afternoon)).toEqual({ action: "skip", reason: "no_subscription" });
  });

  it("keeps the cooldown per beer: not again within the window, fine just after it", () => {
    const hoursAgo = (h: number) => new Date(afternoon.getTime() - h * 3_600_000);
    expect(decide(offer, { ...person, lastSentForBeerAt: hoursAgo(19.9) }, settings, afternoon)).toEqual({ action: "skip", reason: "cooldown" });
    expect(decide(offer, { ...person, lastSentForBeerAt: hoursAgo(20) }, settings, afternoon)).toEqual({ action: "send" });
    expect(decide(offer, { ...person, lastSentForBeerAt: hoursAgo(48) }, settings, afternoon)).toEqual({ action: "send" });
  });

  it("stops at the daily cap", () => {
    expect(decide(offer, { ...person, sentToday: 1 }, settings, afternoon)).toEqual({ action: "send" });
    expect(decide(offer, { ...person, sentToday: 2 }, settings, afternoon)).toEqual({ action: "skip", reason: "daily_cap" });
  });

  it("checks the cooldown and the cap before the clock: a skip is final, a quiet-hours wait is not", () => {
    expect(decide(offer, { ...person, sentToday: 2 }, settings, later)).toEqual({ action: "skip", reason: "daily_cap" });
    expect(decide(offer, person, settings, later)).toEqual({ action: "defer" });
  });
});

describe("quiet hours (Israel local time)", () => {
  const at = (iso: string) => new Date(iso);

  it("wraps midnight, start-inclusive and end-exclusive (22 → 8)", () => {
    // Summer: Israel = UTC+3.
    expect(isQuietHour(at("2026-09-29T18:59:00Z"), 22, 8)).toBe(false); // 21:59
    expect(isQuietHour(at("2026-09-29T19:00:00Z"), 22, 8)).toBe(true); //  22:00
    expect(isQuietHour(at("2026-09-30T04:59:00Z"), 22, 8)).toBe(true); //  07:59
    expect(isQuietHour(at("2026-09-30T05:00:00Z"), 22, 8)).toBe(false); // 08:00
  });

  it("works for a window that does not wrap, and switches off when start equals end", () => {
    expect(isQuietHour(at("2026-09-29T12:00:00Z"), 13, 16)).toBe(true); // 15:00
    expect(isQuietHour(at("2026-09-29T09:00:00Z"), 13, 16)).toBe(false); // 12:00
    expect(isQuietHour(at("2026-09-29T20:00:00Z"), 5, 5)).toBe(false);
  });

  it("follows Israel's clock in winter too (UTC+2)", () => {
    expect(israelHour(at("2026-01-15T20:00:00Z"))).toBe(22);
    expect(isQuietHour(at("2026-01-15T20:00:00Z"), 22, 8)).toBe(true);
    expect(isQuietHour(at("2026-01-15T19:59:00Z"), 22, 8)).toBe(false);
  });
});

describe("the Israeli calendar day (for the daily cap)", () => {
  it("starts at local midnight: 21:00 UTC the evening before in summer", () => {
    expect(israelDayStart(new Date("2026-09-29T12:00:00Z")).toISOString()).toBe("2026-09-28T21:00:00.000Z");
  });
  it("starts at 22:00 UTC the evening before in winter", () => {
    expect(israelDayStart(new Date("2026-01-15T12:00:00Z")).toISOString()).toBe("2026-01-14T22:00:00.000Z");
  });
  it("a push at 00:30 Israel time belongs to the new day, not the old one", () => {
    expect(israelDayStart(new Date("2026-09-29T21:30:00Z")).toISOString()).toBe("2026-09-29T21:00:00.000Z");
  });
});
