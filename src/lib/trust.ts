/**
 * The trust ladder (migration 0038), in TypeScript.
 *
 * What trust is: context for a person's judgement, and weight in a tally. That is
 * the whole list — it is never a permission, and `tests/trust.test.ts` holds that
 * open by giving somebody the highest standing in the system and trying every door.
 *
 * The same ladder exists in SQL (`public.contributor_trust`), because the shelf
 * tally weighs votes inside the database. Two languages, one ladder — and a test
 * asserts they agree at every boundary rather than hoping they do. This module has
 * no `server-only`, so both a server read and that test can use it.
 *
 *   0–49    new       no record to read yet
 *   50–99   known     a few finds accepted
 *   100+    trusted   a good record over time
 */

export type Trust = "new" | "known" | "trusted";

export function trustOf(score: number): Trust {
  if (score >= 100) return "trusted";
  if (score >= 50) return "known";
  return "new";
}

/**
 * How much one person's report counts: 1, 2 from 50, 3 from 100.
 *
 * Capped at three on purpose — a tie-breaker between neighbours in the same shop,
 * not a system where one person's say-so settles a question alone.
 */
export function weightOf(score: number): number {
  return 1 + Math.min(2, Math.floor((score || 0) / 50));
}
