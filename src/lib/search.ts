/**
 * Search that understands how Hebrew is actually typed on a phone.
 *
 * People write גולדסטאר, גולדסטר and גולדסטאר with a niqqud; the same chain as
 * "שופרסל" or "שופר-סל"; "AM:PM" as "ampm"; and half the time in English. So both the
 * query and the text are folded to one plain form before comparing, matching is
 * ranked (exact › prefix › word prefix › substring › looser spellings › one typo),
 * and nothing is ever an error — an odd query just ranks nothing.
 */

const FINAL_TO_REGULAR: Record<string, string> = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };

/** One plain form: no niqqud, no quotes or geresh, no punctuation, no final letters, lower case. */
export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[֑-ׇ]/g, "")
    .replace(/[׳״'"`´’‘“”]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .toLowerCase()
    .replace(/[ךםןףץ]/g, (letter) => FINAL_TO_REGULAR[letter])
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The consonant skeleton: also drop the letters Hebrew spelling adds or omits freely
 * (א ו י ה ע), so "גולדסטאר" and "גולדסטר", or "היינקן" and "היניקן", meet.
 */
export function skeleton(text: string): string {
  return normalize(text).replace(/[אויהע]/g, "");
}

/** True when the two strings differ by at most one insertion, deletion, substitution or swap of neighbours. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  if (short.length !== long.length) return short.slice(i) === long.slice(i + 1); // one letter missing
  if (short.slice(i + 1) === long.slice(i + 1)) return true; // one letter replaced
  return short[i] === long[i + 1] && short[i + 1] === long[i] && short.slice(i + 2) === long.slice(i + 2); // two neighbours swapped
}

/** 0 = no match; larger = better. */
export function score(query: string, candidates: string[]): number {
  const q = normalize(query);
  if (!q) return 1; // an empty query matches everything, equally
  const qs = skeleton(query);
  let best = 0;

  for (const candidate of candidates) {
    const c = normalize(candidate);
    if (!c) continue;
    const cs = skeleton(candidate);
    const words = c.split(" ");

    if (c === q) best = Math.max(best, 100);
    else if (c.startsWith(q)) best = Math.max(best, 85);
    else if (words.some((word) => word.startsWith(q))) best = Math.max(best, 75);
    else if (c.includes(q)) best = Math.max(best, 55);
    // "ampm" for "AM:PM", "שופרסל" for "שופר-סל": punctuation should not decide a match.
    else if (q.replace(/ /g, "").length >= 3 && c.replace(/ /g, "").includes(q.replace(/ /g, ""))) best = Math.max(best, 45);
    else if (qs.length >= 2 && cs.startsWith(qs)) best = Math.max(best, 50);
    else if (qs.length >= 2 && cs.includes(qs)) best = Math.max(best, 40);
    else if (q.length >= 4 && words.some((word) => withinOneEdit(word, q) || withinOneEdit(word.slice(0, q.length), q))) {
      best = Math.max(best, 25);
    }
  }
  return best;
}

/** The items that match, best match first; the original order breaks ties. */
export function search<T>(items: T[], query: string, texts: (item: T) => string[]): T[] {
  if (!normalize(query)) return items;
  return items
    .map((item, index) => ({ item, index, rank: score(query, texts(item)) }))
    .filter((entry) => entry.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map((entry) => entry.item);
}
