import { redirect } from "next/navigation";
import { Screen, TopBar } from "@/components/Chrome";
import { AdminLogin } from "@/components/AdminLogin";
import { getViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Deliberately NOT inside the "(panel)" route group, so the admin layout does
 * not wrap it. That layout redirects non-admins here — and if it applied here
 * too, arriving would redirect to arriving, forever.
 */
export default async function AdminLoginPage() {
  const viewer = await getViewer();
  if (viewer.isAdmin) redirect("/admin");

  return (
    <Screen>
      <TopBar title="כניסת מנהלים" backHref="/settings" />
      <AdminLogin />
    </Screen>
  );
}
