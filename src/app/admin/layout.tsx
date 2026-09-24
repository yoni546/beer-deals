import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The admin shell, and the first of two gates.
 *
 * This redirect keeps non-admins out of the UI. It is NOT what keeps them out
 * of the data — every write below calls an RPC that re-checks the role in
 * Postgres, and every read is subject to RLS. If this file were deleted, an
 * attacker would reach a set of pages that show them nothing and let them do
 * nothing.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  if (!viewer.isAdmin) redirect("/admin/login");

  const tabs = [
    { href: "/admin", label: "ממתינים" },
    { href: "/admin/reports", label: "דיווחים" },
    { href: "/admin/weekly", label: "מבצע השבוע" },
    ...(viewer.isSuperAdmin
      ? [
          { href: "/admin/admins", label: "מנהלים" },
          { href: "/admin/settings", label: "התראות" },
        ]
      : []),
  ];

  return (
    <div className="mx-auto w-full max-w-md px-5 pt-6 pb-12">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-xl font-black">🛠️ ניהול</h1>
        <Link href="/" className="text-sm opacity-60 underline">
          לאפליקציה
        </Link>
      </header>

      <nav className="mb-5 flex flex-wrap gap-1.5">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="rounded-xl bg-[color:var(--surface)] px-3 py-2 text-xs font-bold ring-1 ring-white/10"
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}
