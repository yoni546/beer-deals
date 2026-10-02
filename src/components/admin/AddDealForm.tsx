"use client";

import { useActionState, useState } from "react";
import { addDeal } from "@/lib/actions/admin";
import { IDLE } from "@/lib/actions/result";
import { CATEGORY_LABEL, DEAL_CATEGORIES } from "@/lib/categories";
import { discountPercent, shekelsToAgorot } from "@/lib/money";
import type { Beer, Store } from "@/lib/db/types";

/**
 * Adding a deal by hand, for the case the submission queue cannot cover: an
 * admin standing in a shop, or a deal nobody has reported yet.
 *
 * It is collapsed by default. The queue is the page's job; this is the thing
 * you occasionally need, and an open form at the top would push the work down.
 *
 * The discount is previewed from the two prices with the same formula the
 * database generates — there is no field for it here either, for the same
 * reason there is none on the public form.
 */
export function AddDealForm({ beers, stores }: { beers: Beer[]; stores: Store[] }) {
  const [open, setOpen] = useState(false);
  const [state, submit, pending] = useActionState(addDeal, IDLE);
  const [dealPrice, setDealPrice] = useState("");
  const [regularPrice, setRegularPrice] = useState("");

  const deal = shekelsToAgorot(dealPrice);
  const regular = shekelsToAgorot(regularPrice);
  const preview = deal !== null && regular !== null ? discountPercent(deal, regular) : null;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-quiet w-full">
        + הוספת מבצע ידנית
      </button>
    );
  }

  return (
    <form action={submit} className="space-y-3 rounded-2xl border border-paper-line bg-paper p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-ink">הוספת מבצע</p>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-quiet">
          סגירה
        </button>
      </div>

      <p className="text-xs leading-relaxed text-ink-2">
        מבצע שתוסיפו כאן מתפרסם מיד — אתם מאשרים אותו בעצם ההוספה.
      </p>

      <select name="beerId" required defaultValue="" aria-label="בירה" className="field">
        <option value="" disabled>
          בחרו בירה
        </option>
        {beers.map((beer) => (
          <option key={beer.id} value={beer.id}>
            {beer.name_he}
          </option>
        ))}
      </select>

      <select name="storeId" required defaultValue="" aria-label="חנות" className="field">
        <option value="" disabled>
          בחרו סופר / מכולת
        </option>
        {stores.map((store) => (
          <option key={store.id} value={store.id}>
            {store.name_he}
          </option>
        ))}
      </select>

      <select name="category" defaultValue="sixpack" aria-label="מארז" className="field">
        {DEAL_CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {CATEGORY_LABEL[category]}
          </option>
        ))}
      </select>

      <div className="flex gap-3">
        <label className="flex-1">
          <span className="mb-1 block text-xs text-ink-2">מחיר במבצע ₪</span>
          <input
            name="dealPrice"
            required
            inputMode="decimal"
            placeholder="24.90"
            value={dealPrice}
            onChange={(event) => setDealPrice(event.target.value)}
            className="field num text-right"
          />
        </label>
        <label className="flex-1">
          <span className="mb-1 block text-xs text-ink-2">מחיר רגיל ₪</span>
          <input
            name="regularPrice"
            required
            inputMode="decimal"
            placeholder="39.90"
            value={regularPrice}
            onChange={(event) => setRegularPrice(event.target.value)}
            className="field num text-right"
          />
        </label>
      </div>

      {preview !== null && (
        <p className="text-center text-sm text-ink">
          <span className="num font-bold">{preview}%-</span> הנחה — מחושב אוטומטית
        </p>
      )}

      <input name="notes" maxLength={280} placeholder="הערה (רשות)" aria-label="הערה" className="field" />

      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="notify" className="h-4 w-4" />
        לשלוח התראה למי שזו הבירה הראשית שלו
      </label>
      <p className="-mt-2 text-xs text-ink-3">
        כבוי כברירת מחדל. מבצע שהוספתם ידנית לא מצלצל לאף אחד אלא אם ביקשתם.
      </p>

      {!state.ok && <p className="text-sm text-danger">{state.error}</p>}
      {state.ok && state.message && <p className="text-sm text-ink">{state.message}</p>}

      <button type="submit" disabled={pending} className="btn w-full">
        {pending ? "מוסיפים…" : "הוספה ופרסום"}
      </button>
    </form>
  );
}
