import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin/AdminNav";
import { Screen, TopBar } from "@/components/Chrome";
import { CouldNotLoad } from "@/components/CouldNotLoad";
import { getViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The admin shell, and the first of two gates.
 *
 * It lives in a "(panel)" route group so that /admin/login can sit at its own
 * URL WITHOUT this layout wrapping it. That is not cosmetic: a layout that
 * sends non-admins to /admin/login will send them there from /admin/login as
 * well, and the browser follows that until it gives up. The group changes no
 * URL — /admin, /admin/reports and the rest are exactly where they were.
 *
 * This redirect keeps non-admins out of the UI. It is NOT what keeps them out
 * of the data — every write below calls an RPC that re-checks the role in
 * Postgres, and every read is subject to RLS. If this file were deleted, an
 * attacker would reach a set of pages that show them nothing and let them do
 * nothing.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  // A failed read must not look like "you are not an admin" — that bounced signed-in
  // admins to the sign-in page whenever the database hiccuped.
  if (viewer.degraded && !viewer.isAdmin) {
    return (
      <Screen>
        <div className="pt-10">
          <CouldNotLoad what="את ההרשאות שלך" headingLevel={2} />
        </div>
      </Screen>
    );
  }
  if (!viewer.isAdmin) redirect("/admin/login");

  const tabs = [
    { href: "/admin", label: "בית" },
    { href: "/admin/queue", label: "ממתינים" },
    { href: "/admin/reports", label: "דיווחים" },
    { href: "/admin/weekly", label: "מבצע השבוע" },
    // Every admin can read it, not only a super admin: a log only the most powerful
    // person can see is not accountability, it is a privilege.
    { href: "/admin/audit", label: "יומן" },
    ...(viewer.isSuperAdmin
      ? [
          { href: "/admin/admins", label: "מנהלים" },
          { href: "/admin/settings", label: "התראות" },
        ]
      : []),
  ];

  return (
    <Screen bare>
      <TopBar
        title="ניהול"
        action={
          <Link href="/" className="btn btn-ghost shrink-0">
            לאפליקציה
          </Link>
        }
      />

      <AdminNav tabs={tabs} />

      {children}
    </Screen>
  );
}
