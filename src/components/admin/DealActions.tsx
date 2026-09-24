"use client";

import { useState, useTransition } from "react";
import { approveDeal, setDealStatus, setWeeklyDeal, updateDeal } from "@/lib/actions/admin";
import { CATEGORY_LABEL, CATEGORY_LABEL_ONE, DEAL_CATEGORIES } from "@/lib/categories";
import { formatAgorot, formatPrice } from "@/lib/money";
import type { AdminDeal, Beer, DealStatus, Store } from "@/lib/db/types";

const STATUS_LABEL: Record<DealStatus, string> = {
  pending: "ממתין",
  approved: "מאושר",
  rejected: "נדחה",
  inactive: "הוסר",
};

/**
 * One row of the moderation queue, with its actions.
 *
 * Deactivating is offered instead of deleting. An approved deal carries a
 * record of who approved it and when; taking it off the shelf should not erase
 * that. Real deletion exists but is reserved for a super admin and is not
 * surfaced here.
 */
export function AdminDealRow({
  deal,
  beers,
  stores,
  isWeekly = false,
  canFeature = false,
}: {
  deal: AdminDeal;
  beers: Beer[];
  stores: Store[];
  isWeekly?: boolean;
  canFeature?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(work: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    startTransition(async () => {
      const result = await work();
      setMessage(result.ok ? (result.message ?? "בוצע.") : (result.error ?? "שגיאה."));
    });
  }

  const button = "rounded-xl px-3 py-2 text-xs font-bold ring-1 ring-white/10 disabled:opacity-40";
  const field = "w-full rounded-xl bg-black/20 px-3 py-2 text-sm ring-1 ring-white/10 outline-none";

  return (
    <article className="rounded-2xl bg-[color:var(--surface)] p-4 ring-1 ring-white/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold">{deal.beers?.name_he ?? "—"}</p>
          <p className="text-sm opacity-70">
            {CATEGORY_LABEL_ONE[deal.category]} ·{" "}
            <span className="num">{formatPrice(deal.deal_price_agorot)}</span> ·{" "}
            {deal.stores?.name_he ?? "—"}
          </p>
          <p className="text-xs opacity-50">
            רגיל <span className="num">{formatPrice(deal.regular_price_agorot)}</span> ·{" "}
            <span className="num">{deal.discount_percent}%-</span>
          </p>
        </div>
        <span className="shrink-0 rounded-lg bg-black/25 px-2 py-1 text-[11px] font-bold opacity-70">
          {STATUS_LABEL[deal.status]}
        </span>
      </div>

      {deal.notes && <p className="mt-2 text-xs opacity-60">{deal.notes}</p>}

      {deal.image_url && (
        <a
          href={deal.image_url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs underline opacity-60"
        >
          צפייה בתמונה שצורפה
        </a>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {deal.status !== "approved" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => approveDeal(deal.id))}
            className={`${button} bg-[color:var(--accent)] text-[color:var(--base)]`}
          >
            אישור
          </button>
        )}
        {deal.status === "pending" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => setDealStatus(deal.id, "rejected"))}
            className={button}
          >
            דחייה
          </button>
        )}
        {deal.status === "approved" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => setDealStatus(deal.id, "inactive"))}
            className={button}
          >
            הסרה מהאתר
          </button>
        )}
        <button type="button" onClick={() => setEditing((value) => !value)} className={button}>
          {editing ? "ביטול עריכה" : "עריכה"}
        </button>
        {canFeature && deal.status === "approved" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => setWeeklyDeal(isWeekly ? null : deal.id))}
            className={button}
          >
            {isWeekly ? "הסרה ממבצע השבוע" : "🏆 מבצע השבוע"}
          </button>
        )}
      </div>

      {editing && (
        <form
          action={(formData) => run(() => updateDeal(deal.id, formData))}
          className="mt-3 space-y-2 border-t border-white/10 pt-3"
        >
          <select name="beerId" defaultValue={deal.beer_id} aria-label="בירה" className={field}>
            {beers.map((beer) => (
              <option key={beer.id} value={beer.id}>
                {beer.name_he}
              </option>
            ))}
          </select>
          <select name="storeId" defaultValue={deal.store_id} aria-label="חנות" className={field}>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name_he}
              </option>
            ))}
          </select>
          <select name="category" defaultValue={deal.category} aria-label="מארז" className={field}>
            {DEAL_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {CATEGORY_LABEL[category]}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <input
              name="dealPrice"
              inputMode="decimal"
              defaultValue={formatAgorot(deal.deal_price_agorot)}
              aria-label="מחיר במבצע"
              className={`${field} num`}
            />
            <input
              name="regularPrice"
              inputMode="decimal"
              defaultValue={formatAgorot(deal.regular_price_agorot)}
              aria-label="מחיר רגיל"
              className={`${field} num`}
            />
          </div>
          <input
            name="notes"
            defaultValue={deal.notes ?? ""}
            placeholder="הערה"
            aria-label="הערה"
            className={field}
          />
          <button
            type="submit"
            disabled={pending}
            className={`${button} bg-[color:var(--accent)] text-[color:var(--base)]`}
          >
            שמירת שינויים
          </button>
        </form>
      )}

      {message && <p className="mt-2 text-xs opacity-70">{message}</p>}
    </article>
  );
}
