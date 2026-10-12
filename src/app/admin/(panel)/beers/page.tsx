import { AdminList, AdminSection } from "@/components/admin/AdminUi";
import { AddBeerForm } from "@/components/admin/AddBeerForm";
import { BeerRow } from "@/components/admin/BeerRow";
import { CouldNotLoad } from "@/components/CouldNotLoad";
import { EmptyState } from "@/components/Chrome";
import { getAdminBeers, getAdminBrands, getAdminProductCategories } from "@/lib/admin-queries";
import { identityFor, photoFor } from "@/design/themes";

export const dynamic = "force-dynamic";

/**
 * The beers, from the panel (migration 0034).
 *
 * Two jobs, and the second is the one that did not exist anywhere before:
 *
 *  1. Switch a beer off, put it back, fix a name, change where it sits in the list.
 *  2. Say which beers have no visual identity and no bottle photo. Those cannot be
 *     fixed from a form — an identity is code (src/design/themes.ts) and a photo is
 *     a reviewed asset with provenance (CLAUDE.md) — so this screen is where the
 *     work becomes visible instead of being rediscovered each time somebody notices
 *     a plain bottle.
 */
export default async function AdminBeersPage() {
  const [{ rows, ok }, brands, categories] = await Promise.all([
    getAdminBeers(),
    getAdminBrands(),
    getAdminProductCategories(),
  ]);

  // Read from the code that actually decides the look, so this list cannot drift
  // from what the app shows.
  const look = rows.map((beer) => ({
    beer,
    hasIdentity: identityFor(beer.slug).slug !== "house",
    hasPhoto: photoFor(beer.slug) !== null,
  }));
  const missing = look.filter(({ beer, hasIdentity, hasPhoto }) => beer.is_active && (!hasIdentity || !hasPhoto));

  return (
    <div className="space-y-10">
      <AdminSection
        title="בירות"
        note="הסרה מרשימת הבחירה לא לוקחת את הבירה ממי שכבר בחר אותה — גם לא אם היא הבירה הראשית שלו."
      >
        {!ok ? (
          <div className="px-4 py-6">
            <CouldNotLoad what="את רשימת הבירות" headingLevel={3} />
          </div>
        ) : (
          <div className="space-y-3">
            <AddBeerForm brands={brands} categories={categories} />
            {rows.length === 0 ? (
              <EmptyState>אין בירות.</EmptyState>
            ) : (
              <AdminList>
                {look.map(({ beer, hasIdentity, hasPhoto }) => (
                  <BeerRow
                    key={beer.id}
                    beer={beer}
                    categories={categories}
                    hasIdentity={hasIdentity}
                    hasPhoto={hasPhoto}
                  />
                ))}
              </AdminList>
            )}
          </div>
        )}
      </AdminSection>

      {missing.length > 0 && (
        <AdminSection
          title="מחכות למראה שלהן"
          note="זהות ויזואלית ותמונת בקבוק נוספות בקוד, לא מכאן. זו רשימת העבודה."
        >
          <AdminList>
            {missing.map(({ beer, hasIdentity, hasPhoto }) => (
              <div key={beer.id} className="px-4 py-3">
                <p className="text-base font-bold text-ink">{beer.name_he}</p>
                <p className="mt-0.5 text-sm text-ink-2">
                  <span className="num" dir="ltr">
                    {beer.slug}
                  </span>{" "}
                  · {!hasIdentity && "חסרה זהות"}
                  {!hasIdentity && !hasPhoto && " · "}
                  {!hasPhoto && "חסרה תמונה"}
                  {" · ראשונה אצל "}
                  <span className="num font-bold text-ink">{beer.first_for}</span>
                </p>
              </div>
            ))}
          </AdminList>
        </AdminSection>
      )}
    </div>
  );
}
