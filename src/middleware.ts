import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

/**
 * Two jobs, in this order:
 *
 *  1. Refresh the Supabase session so Server Components always render against a
 *     live token.
 *  2. If there is no session at all, create an ANONYMOUS one.
 *
 * (2) is what makes the product's core promise work: one WhatsApp link and the
 * app is usable immediately, with no sign-up. It is not a shortcut around
 * security — an anonymous user is a real auth.uid(), so Row Level Security can
 * still say "your profile", "your favourites", "your submission". The
 * alternative, letting people browse with no identity at all, would mean
 * personalisation had to be trusted from the client.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  // getUser(), not getSession(): it verifies the token with the auth server
  // rather than trusting a cookie the browser handed us.
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      // Anonymous sign-ins are off in the Supabase dashboard, or the project is
      // unreachable. Let the request through — the page renders a clear
      // explanation instead of an infinite redirect.
      console.error("[middleware] anonymous sign-in failed:", error.message);
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and the PWA files. The service worker and
     * manifest must be fetchable without a session — a browser requests them
     * outside the page's credential context. The notification worker's endpoint has its own
     * bearer-token check and must not mint an anonymous user for every scheduler call.
     */
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/|screenshots/|api/notifications/|api/version).*)",
  ],
};
