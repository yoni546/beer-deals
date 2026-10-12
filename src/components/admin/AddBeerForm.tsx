"use client";

import { useActionState, useState } from "react";
import { Notice } from "@/components/Chrome";
import { addBeer } from "@/lib/actions/beers";
import { IDLE } from "@/lib/actions/result";

/**
 * Adding a beer by hand (migration 0034).
 *
 * Collapsed by default, like adding a deal: the list is the page's job and this is
 * the thing you occasionally need.
 *
 * There is no field for the look. A beer arrives with no identity and no bottle
 * photo and that is a complete, working state — it gets the house palette and an
 * unlabelled bottle, which is already what the app does for a beer it does not
 * know. Giving it its own look is an edit to src/design/themes.ts and a reviewed
 * photo with provenance, so the form says that instead of offering a colour
 * picker that would become a second source of truth for the one thing this
 * product is built around.
 */
export function AddBeerForm({
  brands,
  categories,
}: {
  brands: Array<{ slug: string; name_he: string }>;
  categories: Array<{ slug: string; name_he: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [state, submit, pending] = useActionState(addBeer, IDLE);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-quiet w-full">
        + הוספת בירה
      </button>
    );
  }

  return (
    <form action={submit} className="space-y-3 rounded-2xl border border-paper-line bg-paper p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-ink">הוספת בירה</p>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-quiet">
          סגירה
        </button>
      </div>

      <div>
        <label htmlFor="new-beer-name-he" className="mb-1 block text-sm font-semibold text-ink">
          שם בעברית
        </label>
        <input id="new-beer-name-he" name="nameHe" placeholder="למשל: אסטרייה דאם" className="field" required />
      </div>

      <div>
        <label htmlFor="new-beer-name-en" className="mb-1 block text-sm font-semibold text-ink">
          שם באנגלית
        </label>
        <input id="new-beer-name-en" name="nameEn" placeholder="Estrella Damm" dir="ltr" className="field" required />
      </div>

      <div>
        <label htmlFor="new-beer-slug" className="mb-1 block text-sm font-semibold text-ink">
          מזהה
        </label>
        <input
          id="new-beer-slug"
          name="slug"
          placeholder="estrella-damm"
          dir="ltr"
          pattern="[a-z0-9\-]+"
          className="field num"
          required
        />
        {/* Said before it is typed, because it cannot be changed afterwards. */}
        <p className="mt-1 text-sm text-ink-2">
          אותיות אנגליות קטנות, ספרות ומקפים. זו הכתובת של הדף ושם קובץ התמונה — ואי אפשר לשנות אותה אחר כך.
        </p>
      </div>

      <div>
        <label htmlFor="new-beer-brand" className="mb-1 block text-sm font-semibold text-ink">
          מותג
        </label>
        <select id="new-beer-brand" name="brand" defaultValue="" className="field" required>
          <option value="" disabled>
            בחרו מותג
          </option>
          {brands.map((brand) => (
            <option key={brand.slug} value={brand.slug}>
              {brand.name_he}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label htmlFor="new-beer-category" className="mb-1 block text-sm font-semibold text-ink">
            קטגוריה
          </label>
          <select id="new-beer-category" name="category" defaultValue="beer" className="field">
            {categories.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.name_he}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label htmlFor="new-beer-variant" className="mb-1 block text-sm font-semibold text-ink">
            גרסה (רשות)
          </label>
          <input id="new-beer-variant" name="variant" placeholder="אדום / ללא אלכוהול" className="field" />
        </div>
      </div>

      <p className="text-sm leading-relaxed text-ink-2">
        הבירה תקבל את המראה הניטרלי ובקבוק בלי תווית. זהות ויזואלית ותמונת בקבוק נוספות בקוד, לא מכאן.
      </p>

      <button type="submit" disabled={pending} className="btn w-full">
        הוספה
      </button>

      {!state.ok && <Notice tone="error">{state.error}</Notice>}
      {state.ok && state.message && <Notice tone="info">{state.message}</Notice>}
    </form>
  );
}
