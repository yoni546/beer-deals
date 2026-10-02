import { Screen, TopBar } from "@/components/Chrome";
import { AdminPasswordReset } from "@/components/admin/AdminPasswordReset";

export const dynamic = "force-dynamic";

/**
 * Deliberately NOT inside the "(panel)" route group, for the same reason as the
 * login page: that layout sends anyone who is not an admin to /admin/login, and
 * somebody resetting a forgotten password is, at that moment, exactly such a
 * person. Inside the group, the page that fixes the problem would be unreachable
 * to everyone who has it.
 */
export default function AdminResetPage() {
  return (
    <Screen>
      <TopBar title="איפוס סיסמה" backHref="/admin/login" />
      <AdminPasswordReset />
    </Screen>
  );
}
