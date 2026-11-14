import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

/** How close to expiry a token must be before we spend a round trip refreshing it. */
const REFRESH_WITHIN_SECONDS = 120;

/**
 * The project this build talks to, as it appears in its own cookie names.
 *
 * `null` only if the URL is not a Supabase one, which `publicEnv` would already have
 * refused to start on; the caller falls back to the old, broader test rather than
 * guessing, because being wrong in that direction costs a person their account.
 */
const PROJECT_REF = /^https:\/\/([a-z0-9]+)\.supabase\./.exec(publicEnv.supabaseUrl)?.[1] ?? null;

/**
 * Does the browser claim to have a session **with this project**?
 * (@supabase/ssr may split it across chunks: sb-<ref>-auth-token.0, .1 …)
 *
 * MEASURED, production, 2026-11-14, three days after the move to Frankfurt: every
 * returning visitor was stuck on "לא הצלחנו להתחבר", permanently, while a browser
 * that had never opened the app worked. Their browsers still held
 * `sb-itpyyexhmvosxcbcagvy-auth-token` — the OLD project's cookie. This test matched
 * it on the `sb-`/`auth-token` shape alone, so the branch below read "a cookie we
 * cannot decode" and passed the request through without minting an identity, exactly
 * as it is meant to for a half-written chunk. But a cookie addressed to another
 * project is not this project's unreadable session: it can never become readable, so
 * passing through means that visitor never gets a session again.
 *
 * Scoped to this project's ref, the old cookie is simply someone else's and the
 * visitor is treated as new, which after a project move is what they are.
 */
function hasAuthCookie(request: NextRequest): boolean {
  const prefix = PROJECT_REF ? `sb-${PROJECT_REF}-` : "sb-";
  return request.cookies.getAll().some(({ name }) => name.startsWith(prefix) && name.includes("auth-token"));
}

/**
 * Two jobs, in this order:
 *
 *  1. Keep the Supabase session fresh so Server Components always render against a
 *     live token.
 *  2. If there is no session at all, create an ANONYMOUS one.
 *
 * (2) is what makes the product's core promise work: one WhatsApp link and the
 * app is usable immediately, with no sign-up. It is not a shortcut around
 * security — an anonymous user is a real auth.uid(), so Row Level Security can
 * still say "your profile", "your favourites", "your submission". The
 * alternative, letting people browse with no identity at all, would mean
 * personalisation had to be trusted from the client.
 *
 * Two things were wrong here before 0.11.0.
 *
 * **It replaced people's identities.** `getUser()` reports `{ user: null }` for every
 * failure, not only for "no session": an expired access token whose refresh was
 * already consumed by a concurrent request, a GoTrue 5xx, a rate-limited project.
 * That branch was indistinguishable from a first visit, so the response minted a
 * brand-new anonymous user and the person's profile, their beers and their admin row
 * were gone. Anonymous sign-ins are also rate-limited (~30/hour/IP), so on a shared
 * mobile network one burst left every later visitor stuck on "לא הצלחנו להתחבר".
 * We now mint an identity only when the browser presents no session cookie at all.
 *
 * **It put a network hop in front of every request.** `getUser()` calls the auth
 * server, and on a cold session that is an Israel→Tokyo round trip before the request
 * even reaches the function — paid again by every `<Link>` prefetch. Middleware makes
 * no trust decision (authorization lives in Postgres, and `getViewer()` does its own
 * verifying `getUser()`), so it does not need the verification hop on a request whose
 * token is demonstrably still valid. We spend it only when the token is near expiry,
 * which is when it buys the refresh this function exists for.
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

  // Reads the cookie, no network. Nothing is trusted from it beyond "when does this expire".
  const { data: stored } = await supabase.auth.getSession();
  const expiresAt = stored.session?.expires_at ?? 0;
  const secondsLeft = expiresAt - Math.floor(Date.now() / 1000);

  if (stored.session && secondsLeft > REFRESH_WITHIN_SECONDS) {
    // Still valid for a while: the page's own getUser() will verify it. Nothing to do.
    return response;
  }

  if (stored.session) {
    // Near expiry (or past it): this is the round trip that refreshes and rewrites the cookie.
    const { error } = await supabase.auth.getUser();
    if (error) console.error("[beer-deals] warn middleware.refresh_failed reason=" + JSON.stringify(error.message));
    return response;
  }

  if (hasAuthCookie(request)) {
    // A cookie is present but unreadable — a half-written chunk, or a project that is
    // refusing us. Letting the request through costs this person a signed-out render;
    // minting a new user would cost them their account. Pass through.
    console.error("[beer-deals] warn middleware.session_cookie_unreadable");
    return response;
  }

  const { error } = await supabase.auth.signInAnonymously();
  if (error) {
    // Anonymous sign-ins are off in the Supabase dashboard, the project is unreachable,
    // or we are over the per-IP limit. Let the request through — the page renders a clear
    // explanation instead of an infinite redirect.
    console.error("[beer-deals] error middleware.anonymous_sign_in_failed reason=" + JSON.stringify(error.message));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and the PWA files. The service worker and
     * manifest must be fetchable without a session — a browser requests them
     * outside the page's credential context. The notification worker's and the cache
     * doorbell's endpoints have their own bearer-token check and must not mint an anonymous
     * user for every scheduler call. The bottle photos are public static files; running the
     * session machinery for each one only added latency to the LCP image. /privacy is opened from the app
     * stores by reviewers and strangers, and must not mint an account for every reader; /.well-known/ is
     * read by Android and iOS to verify the apps (assetlinks.json, apple-app-site-association).
     */
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/|bottles/|onboarding/|screenshots/|api/notifications/|api/cache/|api/version|privacy|\.well-known/).*)",
  ],
};
