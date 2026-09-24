import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

/**
 * Request-scoped client for Server Components, Server Actions and handlers.
 *
 * Server Components cannot set cookies, so `setAll` swallows the error there.
 * That is safe here only because middleware refreshes the session on every
 * request, so a token that expires mid-render is renewed on the next one.
 */
export async function supabaseServer() {
  const store = await cookies();

  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component; middleware owns the refresh.
        }
      },
    },
  });
}
