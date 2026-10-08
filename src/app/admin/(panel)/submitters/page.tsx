import { AdminList, AdminSection } from "@/components/admin/AdminUi";
import { SubmitterRow } from "@/components/admin/SubmitterRow";
import { CouldNotLoad } from "@/components/CouldNotLoad";
import { EmptyState } from "@/components/Chrome";
import { getAdminSubmitters } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";

/**
 * The people who send us deals (migration 0035).
 *
 * NOT a list of users, and not by omission: "Admins are deliberately NOT given
 * read access to every profile. Moderating deals does not require knowing who
 * else uses the app" (migration 0003). A screen listing names, emails, cities and
 * favourite beers would reverse that for no moderation benefit at all.
 *
 * So this screen holds the one tool the panel was missing — stopping a particular
 * account from submitting, with a reason, reversibly — and shows only what the
 * person chose to publish and what they sent us.
 */
export default async function AdminSubmittersPage() {
  const { rows, ok } = await getAdminSubmitters();

  return (
    <AdminSection
      title="מי שולח לנו מבצעים"
      note="רק מה שהם פרסמו בעצמם ומה שהם שלחו לנו. אין כאן שמות פרטיים, כתובות מייל, יישובים או בירות — למנהלים אין גישה לפרופילים, וזה לא משתנה."
    >
      {!ok ? (
        <div className="px-4 py-6">
          <CouldNotLoad what="את רשימת השולחים" headingLevel={3} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState>עוד אף אחד לא שלח מבצע.</EmptyState>
      ) : (
        <AdminList>
          {rows.map((person) => (
            <SubmitterRow key={person.user_id} person={person} />
          ))}
        </AdminList>
      )}
    </AdminSection>
  );
}
