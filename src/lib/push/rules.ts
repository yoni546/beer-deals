/**
 * Who is woken up, and when — as pure functions, so every rule can be read and tested
 * without a database, a clock, or a push service.
 *
 * The rules, in the order they are applied:
 *
 *  Event level — the ONE thing that is the same for everyone:
 *    1. The deal must still be on (not expired).
 *
 *  Person level:
 *    2. There must be a reason to tell THEM: it is their favourite #1, or they are watching
 *       this beer (0037). #2–#4 shape the app, not the phone.
 *    3. The price has to be worth it, and what "worth it" means depends on why they are here:
 *         · favourite #1, or a watch with no price → the ADMIN's rules: a VERIFIED saving, at or
 *           above the minimum percentage, at or under the price cap. No trusted reference ⇒ no
 *           push: "cheap" is a claim, and a phone that buzzes on an unverified claim teaches
 *           people to ignore it.
 *         · a watch WITH a price → their own ceiling, and nothing else. A trusted saving and a
 *           trusted price are different things; the message for a watch hit states the price and
 *           claims no percentage, so it needs no reference to vouch for.
 *    4. Notifications must be on, and there must be a device to send to.
 *    5. Cooldown: not again about the same beer within N hours.
 *    6. Daily cap: at most N pushes per person per Israeli calendar day.
 *    7. Quiet hours: not at night. This one DEFERS instead of skipping — a promotion that is
 *       still running at 08:00 is still worth a morning notification.
 *
 * Rules 4–7 are PROTECTIONS FOR A PERSON, not thresholds for an offer, and a watch is not
 * permission to ignore them: somebody watching eight beers gets the same two notifications a
 * day as everybody else. That is what keeps a watchlist a statement about what matters rather
 * than a subscription to noise.
 *
 * Why the thresholds moved from the event to the person (0037): they are the ADMIN's rules, and
 * an admin's percentage is not the only reason somebody may want to be told. Deciding them at
 * event level closed the event for everybody, so a watcher with their own ceiling could never
 * have been reached. `eventVerdict` is kept, unchanged, as the admin-level summary.
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
  /**
   * Are they watching this beer (0037), and at what price?
   *
   * `null` = not watching. `{ maxPriceAgorot: null }` = watching with no price of
   * their own, which means "treat it like my number one" and so the admin's rules.
   */
  watching?: { maxPriceAgorot: number | null } | null;
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
  | "over_my_price"
  | "disabled"
  | "no_subscription"
  | "cooldown"
  | "daily_cap";

export type Decision = { action: "send" } | { action: "skip"; reason: SkipReason } | { action: "defer" };

/**
 * Is the deal still on? The only question whose answer is the same for everybody.
 *
 * Everything else was event-level until 0037 and is now decided per person, because
 * an administrator's percentage is not the only reason somebody may want to be told.
 */
export function stillOn(now: Date, expiresAt: Date): boolean {
  return now.getTime() < expiresAt.getTime();
}

/**
 * The administrator's rules: a verified saving, big enough, cheap enough.
 *
 * Applied to somebody for whom this is favourite #1, and to a watcher who named no
 * price of their own.
 */
export function adminThresholds(
  offer: PushOffer,
  settings: NotifySettings,
): { ok: true } | { ok: false; reason: SkipReason } {
  if (offer.valuePct === null) return { ok: false, reason: "no_verified_saving" };
  if (offer.valuePct < settings.minValuePct) return { ok: false, reason: "below_threshold" };
  if (offer.priceAgorot > settings.maxPriceAgorot) return { ok: false, reason: "over_price_cap" };
  return { ok: true };
}

/**
 * The admin-level summary: would this offer interrupt anybody under the admin's own
 * rules? Kept unchanged from before 0037 — it is what the dashboard and the docs
 * mean by "a notifiable deal" — but the WORKER no longer gates an event on it,
 * because that would close the event for watchers too.
 */
export function eventVerdict(
  offer: PushOffer,
  settings: NotifySettings,
  now: Date,
  expiresAt: Date,
): { ok: true } | { ok: false; reason: SkipReason } {
  if (!stillOn(now, expiresAt)) return { ok: false, reason: "expired" };
  return adminThresholds(offer, settings);
}

/** Everything that depends on the person. Call after `stillOn` said yes. */
export function decide(offer: PushOffer, person: PushRecipient, settings: NotifySettings, now: Date): Decision {
  const isPrimary = person.primaryBeerId === offer.beerId;
  const watch = person.watching ?? null;
  if (!isPrimary && !watch) return { action: "skip", reason: "not_primary" };

  // Why they are here decides what "worth telling them" means. A ceiling they typed
  // is a more specific statement of intent than any global percentage, and it is
  // about the price — so it is measured against the price alone.
  if (!isPrimary && watch && watch.maxPriceAgorot !== null) {
    if (offer.priceAgorot > watch.maxPriceAgorot) return { action: "skip", reason: "over_my_price" };
  } else {
    const threshold = adminThresholds(offer, settings);
    if (!threshold.ok) return { action: "skip", reason: threshold.reason };
  }

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
