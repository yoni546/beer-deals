import { redirect } from "next/navigation";
import { AdminSection } from "@/components/admin/AdminUi";
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
    <AdminSection title="מנהלים">
      <AdminRoster roster={roster} currentUserId={viewer.userId ?? ""} />
    </AdminSection>
  );
}
