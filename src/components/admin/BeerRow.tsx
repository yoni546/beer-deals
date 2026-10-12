"use client";

import { useState, useTransition } from "react";
import { Notice } from "@/components/Chrome";
import { useAdminNotice } from "@/components/admin/AdminNotices";
import { setBeerActive, updateBeer } from "@/lib/actions/beers";
import type { AdminBeer } from "@/lib/admin-queries";

/**
 * One beer in the panel (migration 0034).
 *
 * The counts carry the row. "Switch this beer off" is a different decision when it
 * is the app for four hundred people than when nobody has chosen it, and the panel
 * could not tell the difference before — so the numbers are on the line, and
 * switching off says in words that the people who already chose it keep it.
 *
 * There is no slug field and no colour picker. The slug is the page's URL, the key
 * of the beer's identity in src/design/themes.ts and the filename of its photo, so
 * the database refuses to change it. The identity and the photo are code and a
 * reviewed asset: what this screen can do about them is SAY which beers are
 * missing them, which it does above the list.
 */
export function BeerRow({
  beer,
  categories,
  hasIdentity,
  hasPhoto,
}: {
  beer: AdminBeer;
  categories: Array<{ slug: string; name_he: string }>;
  hasIdentity: boolean;
  hasPhoto: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const notify = useAdminNotice();

  function run(work: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    startTransition(async () => {
      const result = await work();
      const said = { ok: result.ok, text: result.ok ? (result.message ?? "בוצע.") : (result.error ?? "שגיאה.") };
      if (notify) notify(said);
      else setMessage(said);
    });
  }

  const fieldId = (name: string) => `beer-${beer.id}-${name}`;
  const categoryName = categories.find((c) => c.slug === beer.category)?.name_he ?? beer.category;

  return (
    <article className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-base font-bold text-ink">
          {beer.name_he}
          {beer.variant && <span className="font-normal text-ink-2"> · {beer.variant}</span>}
        </p>
        {!beer.is_active && (
          <span className="hatch shrink-0 rounded-full border border-paper-line px-2.5 py-0.5 text-xs font-semibold text-ink">
            לא בבחירה
          </span>
        )}
      </div>

      <p className="mt-0.5 text-sm text-ink-2">
        {beer.brand_name_he} · {categoryName} · <span className="num" dir="ltr">{beer.slug}</span>
      </p>

      {/* What would be affected, and what the beer is still missing. Favourite #1 is
          the app, so "chosen by" and "first for" are deliberately two numbers. */}
      <p className="mt-1 text-sm text-ink-2">
        נבחרה על ידי <span className="num font-bold text-ink">{beer.chosen_by}</span> · ראשונה אצל{" "}
        <span className="num font-bold text-ink">{beer.first_for}</span> · מבצעים כרגע{" "}
        <span className="num font-bold text-ink">{beer.live_offers}</span> · מארזים{" "}
        <span className="num font-bold text-ink">{beer.packs}</span>
      </p>

      {(!hasIdentity || !hasPhoto) && (
        <p className="mt-1 text-sm text-ink-2">
          {!hasIdentity && !hasPhoto
            ? "אין לה זהות ויזואלית ואין תמונת בקבוק — מקבלת את המראה הניטרלי."
            : !hasIdentity
              ? "אין לה זהות ויזואלית — מקבלת את המראה הניטרלי."
              : "אין לה תמונת בקבוק — הבקבוק שלה מצויר."}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => setBeerActive(beer.id, !beer.is_active))}
          className={beer.is_active ? "btn btn-danger" : "btn"}
        >
          {beer.is_active ? "הסרה מרשימת הבחירה" : "החזרה לרשימה"}
        </button>
        <button
          type="button"
          aria-expanded={editing}
          onClick={() => setEditing((value) => !value)}
          className="btn btn-quiet"
        >
          {editing ? "ביטול עריכה" : "עריכה"}
        </button>
      </div>

      {editing && (
        <form action={(formData) => run(() => updateBeer(beer.id, formData))} className="tear mt-3 space-y-3 pt-3">
          <div>
            <label htmlFor={fieldId("nameHe")} className="mb-1 block text-sm font-semibold text-ink">
              שם בעברית
            </label>
            <input id={fieldId("nameHe")} name="nameHe" defaultValue={beer.name_he} className="field" />
          </div>
          <div>
            <label htmlFor={fieldId("nameEn")} className="mb-1 block text-sm font-semibold text-ink">
              שם באנגלית
            </label>
            <input id={fieldId("nameEn")} name="nameEn" defaultValue={beer.name_en} dir="ltr" className="field" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor={fieldId("category")} className="mb-1 block text-sm font-semibold text-ink">
                קטגוריה
              </label>
              <select id={fieldId("category")} name="category" defaultValue={beer.category} className="field">
                {categories.map((category) => (
                  <option key={category.slug} value={category.slug}>
                    {category.name_he}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label htmlFor={fieldId("sortOrder")} className="mb-1 block text-sm font-semibold text-ink">
                סדר
              </label>
              <input
                id={fieldId("sortOrder")}
                name="sortOrder"
                inputMode="numeric"
                defaultValue={beer.sort_order}
                className="field num text-right"
              />
            </div>
          </div>
          {/* Said where somebody would otherwise look for the field. */}
          <p className="text-sm text-ink-2">
            את המזהה (<span className="num" dir="ltr">{beer.slug}</span>) ואת המראה של הבירה אי אפשר לשנות מכאן:
            המזהה הוא הכתובת של הדף ושם קובץ התמונה, והמראה נמצא בקוד.
          </p>
          <button type="submit" disabled={pending} className="btn w-full">
            שמירת שינויים
          </button>
        </form>
      )}

      {message && (
        <div className="mt-2">
          <Notice tone={message.ok ? "info" : "error"}>{message.text}</Notice>
        </div>
      )}
    </article>
  );
}
