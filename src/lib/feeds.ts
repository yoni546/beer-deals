import "server-only";

import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { publicEnv } from "@/lib/env";

/**
 * The shared, cookie-less reader and the cache the whole-site reads sit behind.
 *
 * Everything read through here is the same for every visitor: the catalogue
 * (beers, chains, packs, settings) and the feed aggregates. None of it is
 * per-person, and every table involved is `select to anon, authenticated
 * using (true)` with a matching grant, so the anon role sees exactly the rows a
 * signed-in person would. Reading it without cookies is what makes it cacheable
 * at all — a request-bound client would key the cache per session.
 *
 * `FEEDS_TAG` is cleared by every admin mutation (src/lib/actions/admin.ts), so a
 * moderated deal, an edited beer or a changed setting shows at once rather than
 * after the TTL.
 *
 * This lives in its own module rather than in offers.ts because queries.ts needs
 * it too, and offers.ts already imports queries.ts.
 */

export const FEEDS_TAG = "feeds";
const FEEDS_TTL_SECONDS = 300;

export const publicReader = () =>
  createClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

export const cachedFeed = <A extends unknown[], R>(key: string, read: (...args: A) => Promise<R>) =>
  unstable_cache(read, ["feeds", key], { revalidate: FEEDS_TTL_SECONDS, tags: [FEEDS_TAG] });
