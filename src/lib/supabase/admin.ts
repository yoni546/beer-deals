import "server-only";

import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env";

/**
 * Service-role client. It bypasses Row Level Security completely, so it exists
 * for exactly one job: the notification sender, which must read other people's
 * profiles and push subscriptions to know whom to wake.
 *
 * Never reach for this to "make a query work". If a query is blocked by RLS
 * from a normal client, the policy is the thing to fix.
 */
export function supabaseServiceRole() {
  const key = serverEnv().serviceRoleKey;
  if (!key) return null;

  return createClient(publicEnv.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
