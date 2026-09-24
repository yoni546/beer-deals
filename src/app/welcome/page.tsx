import { redirect } from "next/navigation";
import { Onboarding } from "@/components/Onboarding";
import { getViewer } from "@/lib/session";
import { getBeers } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const [viewer, beers] = await Promise.all([getViewer(), getBeers()]);

  if (viewer.isOnboarded) redirect("/");

  if (!viewer.userId) {
    // Middleware creates an anonymous session on every request, so reaching
    // here means Supabase refused — almost always because anonymous sign-ins
    // are still switched off in the dashboard.
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-6 text-center">
        <p className="text-4xl">🍺</p>
        <h1 className="text-xl font-black">לא הצלחנו להתחבר</h1>
        <p className="text-sm opacity-65">
          נסו לרענן את הדף. אם זה נמשך, השרת לא זמין כרגע.
        </p>
      </main>
    );
  }

  return <Onboarding beers={beers} />;
}
