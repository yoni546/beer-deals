"use client";

import { useActionState, useState } from "react";
import { submitDeal } from "@/lib/actions/deals";
import { IDLE } from "@/lib/actions/result";
import { supabaseBrowser } from "@/lib/supabase/client";
import { CATEGORY_EMOJI, CATEGORY_LABEL, DEAL_CATEGORIES } from "@/lib/categories";
import { discountPercent, shekelsToAgorot } from "@/lib/money";
import type { Beer, Store } from "@/lib/db/types";

/**
 * Submit a deal.
 *
 * The discount is shown live as the two prices are typed, using the same
 * formula the database's generated column uses. It is a preview, not an input:
 * there is no field for it and nothing sends it to the server. That is what
 * makes "users do not enter the discount" true rather than merely intended.
 */
export function SubmitDealForm({
  beers,
  stores,
  userId,
}: {
  beers: Beer[];
  stores: Store[];
  userId: string | null;
}) {
  const [state, submit, pending] = useActionState(submitDeal, IDLE);
  const [dealPrice, setDealPrice] = useState("");
  const [regularPrice, setRegularPrice] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const dealAgorot = shekelsToAgorot(dealPrice);
  const regularAgorot = shekelsToAgorot(regularPrice);
  const preview =
    dealAgorot !== null && regularAgorot !== null
      ? discountPercent(dealAgorot, regularAgorot)
      : null;

  async function upload(file: File) {
    if (!userId) return;
    setUploading(true);
    setUploadError(null);

    // The storage policy only accepts writes into a folder named after the
    // uploader id, so this path is not a convention — it is the permission.
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const path = `${userId}/${crypto.randomUUID()}.${extension}`;

    const supabase = supabaseBrowser();
    const { error } = await supabase.storage.from("deal-images").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
    });

    if (error) {
      setUploadError("לא הצלחנו להעלות את התמונה. אפשר לשלוח גם בלעדיה.");
      setUploading(false);
      return;
    }

    const { data } = supabase.storage.from("deal-images").getPublicUrl(path);
    setImageUrl(data.publicUrl);
    setUploading(false);
  }

  if (state.ok && state.message) {
    return (
      <div className="rounded-2xl bg-[color:var(--surface)] p-6 text-center ring-1 ring-white/10">
        <p className="text-3xl">🍺</p>
        <p className="mt-2 font-bold">{state.message}</p>
        <p className="mt-1 text-sm opacity-60">
          מבצע חדש לא מתפרסם אוטומטית — מישהו מאיתנו בודק אותו קודם.
        </p>
      </div>
    );
  }

  const field =
    "w-full rounded-2xl bg-[color:var(--surface)] px-4 py-3.5 ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-[color:var(--accent)]";

  return (
    <form action={submit} className="space-y-4">
      <div>
        <label htmlFor="beerId" className="mb-1.5 block text-sm font-bold">
          איזו בירה?
        </label>
        <select id="beerId" name="beerId" required defaultValue="" className={field}>
          <option value="" disabled>
            בחרו בירה
          </option>
          {beers.map((beer) => (
            <option key={beer.id} value={beer.id}>
              {beer.name_he}
            </option>
          ))}
        </select>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-bold">איזה מארז?</legend>
        <div className="flex gap-1.5">
          {DEAL_CATEGORIES.map((category, index) => (
            <label
              key={category}
              className="flex-1 cursor-pointer rounded-2xl bg-[color:var(--surface)] px-2 py-3 text-center text-sm font-bold ring-1 ring-white/10 has-checked:bg-[color:var(--accent)] has-checked:text-[color:var(--base)]"
            >
              <input
                type="radio"
                name="category"
                value={category}
                defaultChecked={index === 0}
                className="sr-only"
              />
              <span aria-hidden className="ml-1">
                {CATEGORY_EMOJI[category]}
              </span>
              {CATEGORY_LABEL[category]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex gap-3">
        <div className="flex-1">
          <label htmlFor="dealPrice" className="mb-1.5 block text-sm font-bold">
            מחיר במבצע ₪
          </label>
          <input
            id="dealPrice"
            name="dealPrice"
            required
            inputMode="decimal"
            placeholder="24.90"
            value={dealPrice}
            onChange={(event) => setDealPrice(event.target.value)}
            className={`${field} num text-right`}
          />
        </div>
        <div className="flex-1">
          <label htmlFor="regularPrice" className="mb-1.5 block text-sm font-bold">
            מחיר רגיל ₪
          </label>
          <input
            id="regularPrice"
            name="regularPrice"
            required
            inputMode="decimal"
            placeholder="39.90"
            value={regularPrice}
            onChange={(event) => setRegularPrice(event.target.value)}
            className={`${field} num text-right`}
          />
        </div>
      </div>

      {preview !== null && (
        <p className="text-center text-sm font-bold text-[color:var(--accent)]">
          <span className="num">{preview}%-</span> הנחה — מחושב אוטומטית
        </p>
      )}

      <div>
        <label htmlFor="storeId" className="mb-1.5 block text-sm font-bold">
          איפה?
        </label>
        <select id="storeId" name="storeId" required defaultValue="" className={field}>
          <option value="" disabled>
            בחרו סופר / מכולת
          </option>
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name_he}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="notes" className="mb-1.5 block text-sm font-bold">
          משהו להוסיף? <span className="font-normal opacity-50">(רשות)</span>
        </label>
        <input
          id="notes"
          name="notes"
          maxLength={280}
          placeholder="עד יום שישי, במועדון הלקוחות…"
          className={field}
        />
      </div>

      <div>
        <label htmlFor="image" className="mb-1.5 block text-sm font-bold">
          תמונה של המדבקה <span className="font-normal opacity-50">(רשות)</span>
        </label>
        <input
          id="image"
          type="file"
          accept="image/*"
          capture="environment"
          disabled={!userId || uploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
          className="w-full text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-[color:var(--surface)] file:px-4 file:py-2.5 file:text-sm file:font-bold file:text-[color:var(--ink)]"
        />
        {uploading && <p className="mt-1 text-xs opacity-60">מעלים…</p>}
        {imageUrl && <p className="mt-1 text-xs opacity-60">התמונה נשמרה ✓</p>}
        {uploadError && <p className="mt-1 text-xs text-red-300">{uploadError}</p>}
      </div>

      <input type="hidden" name="imageUrl" value={imageUrl} />

      {!state.ok && <p className="text-sm text-red-300">{state.error}</p>}

      <button
        type="submit"
        disabled={pending || uploading}
        className="w-full rounded-2xl bg-[color:var(--accent)] px-4 py-4 font-black text-[color:var(--base)] disabled:opacity-40"
      >
        {pending ? "שולחים…" : "שליחה לאישור"}
      </button>

      <p className="text-center text-xs opacity-50">
        המבצע לא מתפרסם אוטומטית. הוא עובר בדיקה קודם.
      </p>
    </form>
  );
}
