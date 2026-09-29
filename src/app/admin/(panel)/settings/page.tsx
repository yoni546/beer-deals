import { redirect } from "next/navigation";
import { AdminSection } from "@/components/admin/AdminUi";
import { NotificationSettings } from "@/components/admin/NotificationSettings";
import { EmptyState } from "@/components/Chrome";
import { getSettings } from "@/lib/queries";
import { getViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const viewer = await getViewer();
  if (!viewer.isSuperAdmin) redirect("/admin");

  const settings = await getSettings();

  return (
    <AdminSection title="מתי שולחים התראה">
      {settings ? (
        <NotificationSettings settings={settings} />
      ) : (
        <EmptyState>לא נמצאו הגדרות.</EmptyState>
      )}
    </AdminSection>
  );
}
