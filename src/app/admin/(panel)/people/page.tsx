import { AdminList, AdminSection } from "@/components/admin/AdminUi";
import { PersonRow } from "@/components/admin/PersonRow";
import { CouldNotLoad } from "@/components/CouldNotLoad";
import { EmptyState } from "@/components/Chrome";
import { getAdminPeople } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";

/**
 * The people who use the app (migration 0041).
 *
 * Town, how far they will travel, the beers they chose, when they registered, and
 * what they have sent us — the fields the owner asked for by name. Not the private
 * first name, not coordinates, not an email, and nothing about their notifications:
 * `profiles` keeps its owner-only policy and this reads through one function that
 * returns those columns and no others.
 */
export default async function AdminPeoplePage() {
  const { rows, ok } = await getAdminPeople();

  return (
    <AdminSection
      title="האנשים"
      note="היישוב שאמרו, כמה רחוק הם נוסעים, הבירות שבחרו, ומה שלחו לנו. לא שמות פרטיים, לא כתובות מייל ולא מיקום מדויק."
    >
      {!ok ? (
        <div className="px-4 py-6">
          <CouldNotLoad what="את רשימת האנשים" headingLevel={3} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState>עוד אף אחד לא סיים הרשמה.</EmptyState>
      ) : (
        <AdminList>
          {rows.map((person) => (
            <PersonRow key={person.user_id} person={person} />
          ))}
        </AdminList>
      )}
    </AdminSection>
  );
}
