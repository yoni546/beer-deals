"use client";

import { useActionState, useState } from "react";
import { Notice } from "@/components/Chrome";
import { CameraIcon, CheckIcon } from "@/components/ui/icons";
import { Saving } from "@/components/ui/Price";
import { Tape } from "@/components/ui/Tape";
import { submitDeal } from "@/lib/actions/deals";
import { IDLE } from "@/lib/actions/result";
import { supabaseBrowser } from "@/lib/supabase/client";
import { CATEGORY_LABEL, DEAL_CATEGORIES } from "@/lib/categories";
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
    const { error } = await supabase.storage
      .from("deal-images")
      .upload(path, file, {
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
      <Tape className="px-5 py-8 text-center">
        <span
          aria-hidden
          className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-deal text-on-deal"
        >
          <CheckIcon size={22} />
        </span>
        <p className="mt-3 text-lg font-bold text-ink">{state.message}</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-2">
          מבצע חדש לא מתפרסם אוטומטית. מישהו מאיתנו בודק אותו קודם.
        </p>
      </Tape>
    );
  }

  const field = "field";
  const label = "mb-1.5 block text-base font-bold text-ink";

  return (
    <form action={submit}>
      <Tape className="space-y-5 px-5 py-6">
        <div>
          <label htmlFor="beerId" className={label}>
            איזו בירה?
          </label>
          <select
            id="beerId"
            name="beerId"
            required
            defaultValue=""
            className={field}
          >
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
          <legend className={label}>איזה מארז?</legend>
          <div className="flex gap-2">
            {DEAL_CATEGORIES.map((category, index) => (
              <label
                key={category}
                className="group flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-paper-line px-2 py-3 text-center text-sm font-semibold text-ink has-checked:border-ink has-checked:bg-ink has-checked:text-paper has-focus-visible:outline-3 has-focus-visible:outline-focus"
              >
                <input
                  type="radio"
                  name="category"
                  value={category}
                  defaultChecked={index === 0}
                  className="sr-only"
                />
                <span aria-hidden className="hidden group-has-checked:inline">
                  <CheckIcon size={16} />
                </span>
                {CATEGORY_LABEL[category]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex gap-3">
          <div className="flex-1">
            <label htmlFor="dealPrice" className={label}>
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
            <label htmlFor="regularPrice" className={label}>
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
          <p className="rounded-xl bg-paper-2 px-4 py-3 text-center text-sm text-ink">
            <Saving
              pct={preview}
              className="me-1 rounded-md bg-deal px-2 py-1 font-bold text-on-deal"
            />{" "}
            הנחה. מחושב אוטומטית
          </p>
        )}

        <div>
          <label htmlFor="storeId" className={label}>
            איפה?
          </label>
          <select
            id="storeId"
            name="storeId"
            required
            defaultValue=""
            className={field}
          >
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
          <label htmlFor="notes" className={label}>
            משהו להוסיף? <span className="font-normal text-ink-2">(רשות)</span>
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
          <label htmlFor="image" className={label}>
            תמונה של המדבקה{" "}
            <span className="font-normal text-ink-2">(רשות)</span>
          </label>
          {/* The browser's own file control speaks the browser's language ("Choose File"), so the
              real input is visually hidden and this label is the button. It stays keyboard-focusable. */}
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
            className="peer sr-only"
          />
          <label
            htmlFor="image"
            className="btn btn-quiet cursor-pointer peer-disabled:cursor-not-allowed peer-disabled:opacity-50 peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus"
          >
            <CameraIcon size={20} />
            {imageUrl ? "החלפת תמונה" : "צילום או בחירת תמונה"}
          </label>
          {uploading && <p className="mt-1 text-sm text-ink-2">מעלים…</p>}
          {imageUrl && <p className="mt-1 text-sm text-ink-2">התמונה נשמרה.</p>}
          {uploadError && (
            <div className="mt-2">
              <Notice>{uploadError}</Notice>
            </div>
          )}
        </div>

        <input type="hidden" name="imageUrl" value={imageUrl} />

        {!state.ok && <Notice>{state.error}</Notice>}

        <button
          type="submit"
          disabled={pending || uploading}
          className="btn w-full"
        >
          {pending ? "שולחים…" : "שליחה לאישור"}
        </button>

        <p className="text-center text-sm text-ink-2">
          המבצע לא מתפרסם אוטומטית. הוא עובר בדיקה קודם.
        </p>
      </Tape>
    </form>
  );
}
