import { redirect } from "next/navigation";
import { Screen } from "@/components/Chrome";
import { Onboarding } from "@/components/Onboarding";
import { Tape } from "@/components/ui/Tape";
import { getViewer } from "@/lib/session";
import { getBeers } from "@/lib/queries";
import "./onboarding.css";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const [viewer, beers] = await Promise.all([getViewer(), getBeers()]);

  if (viewer.isOnboarded) redirect("/");

  if (!viewer.userId) {
    // Middleware creates an anonymous session on every request, so reaching
    // here means Supabase refused — almost always because anonymous sign-ins
    // are still switched off in the dashboard.
    return (
      <Screen bare>
        <div className="pt-16">
          <Tape className="px-5 py-8 text-center" role="alert">
            <h1 className="text-xl font-bold text-ink">לא הצלחנו להתחבר</h1>
            <div aria-hidden className="mx-auto my-3 w-16 border-t-2 border-dotted border-paper-line" />
            <p className="text-sm leading-relaxed text-ink-2">נסו לרענן את הדף. אם זה נמשך, השרת לא זמין כרגע.</p>
          </Tape>
        </div>
      </Screen>
    );
  }

  return <Onboarding beers={beers} />;
}
