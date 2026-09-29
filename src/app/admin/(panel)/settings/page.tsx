import { redirect } from "next/navigation";
import { AdminSection } from "@/components/admin/AdminUi";
import { NotificationSettings } from "@/components/admin/NotificationSettings";
import { RecentDeliveries } from "@/components/admin/RecentDeliveries";
import { EmptyState } from "@/components/Chrome";
import { getSettings } from "@/lib/queries";
import { getViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const viewer = await getViewer();
  if (!viewer.isSuperAdmin) redirect("/admin");

  const settings = await getSettings();

  return (
    <div className="space-y-10">
      <AdminSection title="מתי שולחים התראה">
        {settings ? <NotificationSettings settings={settings} /> : <EmptyState>לא נמצאו הגדרות.</EmptyState>}
      </AdminSection>

      <AdminSection title="התראות אחרונות" note="מה נשלח, למי (מזהה מקוצר) ולמה לא.">
        <RecentDeliveries />
      </AdminSection>
    </div>
  );
}
