import "server-only";

import { reasonOf, report } from "@/lib/log";

/**
 * One read that is allowed to fail without taking the page with it.
 *
 * The reads in `src/lib/offers.ts` throw rather than return an empty list, and that
 * is deliberate: an empty list would say "there are no deals" when the truth is "we
 * could not look", which is the one thing CLAUDE.md forbids for prices. The throw is
 * right; what was wrong is that a single app-wide error boundary turned any one of
 * them into a blank screen.
 *
 * So a page wraps each independent read in `attempt()`, renders the sections that
 * succeeded, and renders `<CouldNotLoad>` where one did not. The person still gets
 * their beers when the "more deals" strip is unreachable, and nothing anywhere
 * claims an absence it did not verify.
 *
 * `Promise.allSettled` alone would not do: it loses the distinction between "read
 * succeeded and found nothing" and "read failed", which is exactly the distinction
 * that matters here.
 */

export type Attempt<T> = { ok: true; value: T } | { ok: false; reason: string };

export async function attempt<T>(what: string, read: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (cause) {
    const reason = reasonOf(cause);
    report("read.failed", { what, reason });
    return { ok: false, reason };
  }
}

/** The value, or a stand-in — for a read whose absence changes nothing the person can see. */
export function or<T>(result: Attempt<T>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/** True when the read failed, i.e. a section must say so rather than show nothing. */
export function failed(result: Attempt<unknown>): boolean {
  return !result.ok;
}
