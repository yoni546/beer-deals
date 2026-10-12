import { redirect } from "next/navigation";
import { Screen } from "@/components/Chrome";
import { Onboarding } from "@/components/Onboarding";
import { Tape } from "@/components/ui/Tape";
import { getViewer } from "@/lib/session";
import { getBeers } from "@/lib/queries";
import { describeEnvironment } from "@/lib/environment";
import { publicEnv } from "@/lib/env";
import "./onboarding.css";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const [viewer, beers] = await Promise.all([getViewer(), getBeers()]);

  if (viewer.isOnboarded) redirect("/");

  if (!viewer.userId) {
    // Middleware creates an anonymous session on every request, so reaching
    // here means Supabase refused — almost always because anonymous sign-ins
    // are still switched off in the dashboard.
    //
    // The visitor gets the same sentence either way. Away from production we
    // ALSO print what the project actually answered, because the alternative is
    // reading a server log, and whoever is looking at this screen on staging is
    // the person trying to fix it. Never in production: a stranger reading an
    // error screen learns nothing about our auth provider.
    const reason = await anonymousSignInReason();

    return (
      <Screen bare>
        <div className="pt-16">
          <Tape className="px-5 py-8 text-center" role="alert">
            <h1 className="text-xl font-bold text-ink">לא הצלחנו להתחבר</h1>
            <div aria-hidden className="mx-auto my-3 w-16 border-t-2 border-dotted border-paper-line" />
            <p className="text-sm leading-relaxed text-ink-2">נסו לרענן את הדף. אם זה נמשך, השרת לא זמין כרגע.</p>
            {reason && (
              <p dir="ltr" className="mt-4 whitespace-pre-wrap break-words border-t border-dotted border-paper-line pt-3 text-start font-mono text-xs leading-relaxed text-ink-3">
                {reason}
              </p>
            )}
          </Tape>
        </div>
      </Screen>
    );
  }

  return <Onboarding beers={beers} />;
}

/**
 * What the Supabase project says when asked for an anonymous session, as plain
 * text, for the error screen above — and only away from production.
 *
 * It asks the auth endpoint directly rather than reporting what the middleware
 * saw, so the answer is this request's own, and it returns the HTTP status next
 * to the body: "refused" and "unreachable" look identical in a message string
 * and need completely different fixes.
 */
async function anonymousSignInReason(): Promise<string | null> {
  if (describeEnvironment().name === "production") return null;

  try {
    const response = await fetch(`${publicEnv.supabaseUrl}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: publicEnv.supabaseAnonKey, "content-type": "application/json" },
      body: JSON.stringify({ data: {} }),
      cache: "no-store",
    });
    const body = (await response.text()).slice(0, 400);
    return `anonymous sign-in → HTTP ${response.status}\n${body}`;
  } catch (error) {
    return `anonymous sign-in → could not reach ${publicEnv.supabaseUrl}\n${error instanceof Error ? error.message : String(error)}`;
  }
}
