/**
 * Version comparison, kept dependency-free on purpose: the What's New link is a
 * Client Component, and importing the release schema (zod + the JSON) into it
 * would ship all of that to every visitor's phone.
 */

/** Compares "1.10.0" > "1.9.0" numerically, not as text. */
export function compareVersions(a: string, b: string): number {
  const [pa, pb] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** True when `seen` is missing or older than `latest`. */
export function isUnseen(seen: string | null | undefined, latest: string | null | undefined): boolean {
  if (!latest) return false;
  return !seen || compareVersions(seen, latest) < 0;
}
