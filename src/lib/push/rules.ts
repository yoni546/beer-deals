/**
 * Who is woken up, and when — as pure functions, so every rule can be read and tested
 * without a database, a clock, or a push service.
 *
 * The rules, in the order they are applied:
 *
 *  Event level (the same for everyone):
 *    1. The deal must still be on (not expired).
 *    2. It must carry a VERIFIED saving. No trusted reference price ⇒ no push: "cheap" is a
 *       claim, and a phone that buzzes on an unverified claim teaches people to ignore it.
 *    3. The saving must reach the admin's minimum, and the price must be under the admin's cap.
 *
 *  Person level:
 *    4. Only the PRIMARY beer (favourite #1) may interrupt. #2–#4 shape the app, not the phone.
 *    5. Notifications must be on, and there must be a device to send to.
 *    6. Cooldown: not again about the same beer within N hours.
 *    7. Daily cap: at most N pushes per person per Israeli calendar day.
 *    8. Quiet hours: not at night. This one DEFERS instead of skipping — a promotion that is
 *       still running at 08:00 is still worth a morning notification.
 */

export const ISRAEL = "Asia/Jerusalem";

export type NotifySettings = {
  minValuePct: number;
  maxPriceAgorot: number;
  cooldownHours: number;
  dailyCap: number;
  /** Israeli local hour (0–23). Equal start and end means there are no quiet hours. */
  quietStart: number;
  quietEnd: number;
};

/** The parts of an `offers_feed` row the rules look at. */
export type PushOffer = {
  beerId: string;
  /** Price of one pack (for a multi-buy, the per-pack price). */
  priceAgorot: number;
  /** Verified saving, or null when there is no trusted reference. */
  valuePct: number | null;
};

export type PushRecipient = {
  userId: string;
  primaryBeerId: string | null;
  notificationsEnabled: boolean;
  subscriptions: number;
  /** Last successful push to this person about THIS beer. */
  lastSentForBeerAt: Date | null;
  /** Successful pushes to this person since the start of today (Israel). */
  sentToday: number;
};

export type SkipReason =
  | "expired"
  | "no_verified_saving"
  | "below_threshold"
  | "over_price_cap"
  | "not_primary"
  | "disabled"
  | "no_subscription"
  | "cooldown"
  | "daily_cap";

export type Decision = { action: "send" } | { action: "skip"; reason: SkipReason } | { action: "defer" };

/** Rules that depend only on the offer: if it fails these, nobody gets it. */
export function eventVerdict(
  offer: PushOffer,
  settings: NotifySettings,
  now: Date,
  expiresAt: Date,
): { ok: true } | { ok: false; reason: SkipReason } {
  if (now.getTime() >= expiresAt.getTime()) return { ok: false, reason: "expired" };
  if (offer.valuePct === null) return { ok: false, reason: "no_verified_saving" };
  if (offer.valuePct < settings.minValuePct) return { ok: false, reason: "below_threshold" };
  if (offer.priceAgorot > settings.maxPriceAgorot) return { ok: false, reason: "over_price_cap" };
  return { ok: true };
}

/** Rules that depend on the person. Call after `eventVerdict` said ok. */
export function decide(offer: PushOffer, person: PushRecipient, settings: NotifySettings, now: Date): Decision {
  if (person.primaryBeerId !== offer.beerId) return { action: "skip", reason: "not_primary" };
  if (!person.notificationsEnabled) return { action: "skip", reason: "disabled" };
  if (person.subscriptions === 0) return { action: "skip", reason: "no_subscription" };

  if (person.lastSentForBeerAt && now.getTime() - person.lastSentForBeerAt.getTime() < settings.cooldownHours * 3_600_000) {
    return { action: "skip", reason: "cooldown" };
  }
  if (person.sentToday >= settings.dailyCap) return { action: "skip", reason: "daily_cap" };

  if (isQuietHour(now, settings.quietStart, settings.quietEnd)) return { action: "defer" };
  return { action: "send" };
}

/** The hour of day (0–23) it is in Israel at `now`. Handles the clock changes correctly. */
export function israelHour(now: Date): number {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone: ISRAEL, hour: "numeric", hourCycle: "h23" }).format(now);
  return Number(hour);
}

/**
 * Is `now` inside the quiet window? The window may wrap midnight (22 → 8), and is
 * start-inclusive, end-exclusive: with 22 → 8, 21:59 is loud, 22:00 quiet, 07:59 quiet, 08:00 loud.
 */
export function isQuietHour(now: Date, start: number, end: number): boolean {
  if (start === end) return false;
  const hour = israelHour(now);
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** The instant the current Israeli calendar day began (midnight there), as a UTC Date. */
export function israelDayStart(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ISRAEL, year: "numeric", month: "2-digit", day: "2-digit" }).format(now); // YYYY-MM-DD
  // Midnight Israel = that date at 00:00 in Israel's offset at that moment. Try both possible offsets.
  for (const offsetHours of [3, 2]) {
    const candidate = new Date(`${parts}T00:00:00.000Z`);
    candidate.setUTCHours(candidate.getUTCHours() - offsetHours);
    if (new Intl.DateTimeFormat("en-CA", { timeZone: ISRAEL, year: "numeric", month: "2-digit", day: "2-digit" }).format(candidate) === parts && israelHour(candidate) === 0) {
      return candidate;
    }
  }
  // Fallback that is never more than an hour off: the clock-change edge.
  return new Date(`${parts}T00:00:00.000Z`);
}
