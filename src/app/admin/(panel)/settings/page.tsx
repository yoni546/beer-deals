import { redirect } from "next/navigation";
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
    <section>
      <h2 className="mb-3 text-sm font-black opacity-70">מתי שולחים התראה</h2>
      {settings ? (
        <NotificationSettings settings={settings} />
      ) : (
        <EmptyState>לא נמצאו הגדרות.</EmptyState>
      )}
    </section>
  );
}
