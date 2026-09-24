import { redirect } from "next/navigation";
import { AdminRoster } from "@/components/admin/AdminRoster";
import { getAdminRoster } from "@/lib/admin-queries";
import { getViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminsPage() {
  const viewer = await getViewer();
  // Regular admins have no business here. The RPCs would refuse them anyway.
  if (!viewer.isSuperAdmin) redirect("/admin");

  const roster = await getAdminRoster();

  return (
    <section>
      <h2 className="mb-3 text-sm font-black opacity-70">מנהלים</h2>
      <AdminRoster roster={roster} currentUserId={viewer.userId ?? ""} />
    </section>
  );
}
