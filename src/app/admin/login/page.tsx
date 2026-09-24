import { redirect } from "next/navigation";
import { Screen, TopBar } from "@/components/Chrome";
import { AdminLogin } from "@/components/AdminLogin";
import { getViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Lives outside the admin layout on purpose: the layout redirects non-admins
 * here, and a login page behind that guard would redirect to itself forever.
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
