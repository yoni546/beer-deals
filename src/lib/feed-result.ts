/**
 * What to do with a read that failed — kept out of feeds.ts, which is
 * `server-only` and therefore cannot be imported by a test. (src/lib/trust.ts
 * sits outside its SQL for the same reason.) Nothing here touches the network
 * or the environment; it is two decisions about a result that already came back.
 */

/**
 * A read that failed is not an answer, and must not be stored as one.
 *
 * Every catalogue reader used to end `data ?? []`, which turns a refused or
 * unreachable query into an empty catalogue — and `unstable_cache` then keeps
 * that empty catalogue for the full TTL. Staging showed the cost: with a broken
 * anon key every read failed, each failure was cached as "no beers", and after
 * the key was fixed the onboarding screen still had nothing to choose from for
 * five more minutes. The database was fine the whole time.
 *
 * Throwing is the fix, because `unstable_cache` stores nothing when the reader
 * throws: the next request asks again instead of being served a failure.
 */
export function rows<T>(result: { data: T[] | null; error: { message: string } | null }, what: string): T[] {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data ?? [];
}

/**
 * Run a cached read and fall back if it throws, without the failure being
 * cached. The screen degrades for one request; the next one re-reads.
 */
export async function orEmpty<R>(read: () => Promise<R>, fallback: R, what: string): Promise<R> {
  try {
    return await read();
  } catch (error) {
    console.error(`[beer-deals] warn feed.read_failed feed=${what} reason=${JSON.stringify(String(error))}`);
    return fallback;
  }
}
