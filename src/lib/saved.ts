/**
 * Saved deals (0.41.0): which offers this person kept, by offer_key.
 *
 * KEPT IN A COOKIE ON THE DEVICE, not in the database. The person is an anonymous
 * account on this one device anyway, so a table would not follow them anywhere a
 * cookie does not; and a cookie needs no migration, no grants and no production step.
 * It is a cookie rather than localStorage so the server can read it: /saved renders
 * the CURRENT offers for these keys from the live feed. Nothing about a deal is
 * stored here except its key, so a saved deal can never show a stale price — if the
 * price changes or the deal ends, its key is no longer in the feed, and /saved says
 * so instead of showing what it used to cost.
 *
 * Shared by the save button (client) and /saved (server): plain functions, no imports.
 */

export const SAVED_COOKIE = "saved_offers";

/** A cookie is ~4 KB; a key is under 50 characters. Oldest saves drop off first. */
export const SAVED_MAX = 40;

/** obs:<id> (chain feed), deal:<uuid> (submitted), grp:<id> (mix-and-match). Anything else is ignored. */
const KEY = /^(obs|deal|grp):[\w-]{1,64}$/;

export function parseSaved(value: string | undefined | null): string[] {
  if (!value) return [];
  let raw = value;
  try {
    raw = decodeURIComponent(value);
  } catch {
    // Not encoded: read it as it is.
  }
  const keys = raw.split("|").filter((key) => KEY.test(key));
  return [...new Set(keys)].slice(-SAVED_MAX);
}

export function serializeSaved(keys: string[]): string {
  return [...new Set(keys.filter((key) => KEY.test(key)))].slice(-SAVED_MAX).join("|");
}

/** Add or remove one key; the newest save goes last. */
export function toggleSaved(keys: string[], key: string): string[] {
  return keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];
}
