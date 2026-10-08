"use client";

import { useState, useTransition } from "react";
import { Notice } from "@/components/Chrome";
import { useAdminNotice } from "@/components/admin/AdminNotices";
import { SparkIcon } from "@/components/ui/icons";
import { Price, Saving } from "@/components/ui/Price";
import { approveDeal, deleteDeal, setDealStatus, setWeeklyDeal, updateDeal } from "@/lib/actions/admin";
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
 *
 * A row is a line on the tape: beer and status, then "pack · chain ········ price",
 * then the regular price and the saving the database computed. A deal that is
 * still waiting for a decision is hatched as well as labelled — unverified data
 * is marked in words and pattern, never colour alone.
 */
/**
 * The attached photo's link, or null.
 *
 * Only https survives. Everything else — javascript:, data:, a relative path that
 * would resolve against the admin panel — is dropped rather than rendered, because
 * this link is shown to a moderator and its value came from a stranger.
 */
function safePhotoHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

export function AdminDealRow({
  deal,
  beers,
  stores,
  isWeekly = false,
  canFeature = false,
  canDelete = false,
}: {
  deal: AdminDeal;
  beers: Beer[];
  stores: Store[];
  isWeekly?: boolean;
  canFeature?: boolean;
  /**
   * Super admins only. "Remove from the site" keeps the record of who approved
   * the deal and when; deleting destroys it. So it asks first, and it is not
   * the button that falls under your thumb.
   */
  canDelete?: boolean;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  // Approving a deal moves it between lists and removing one takes it off the page,
  // so the panel shows the outcome above the list, where the action cannot unmount
  // it. Without the provider (a test, or a page that does not have it) the row says
  // it itself, as it always did.
  const notify = useAdminNotice();

  function run(work: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    startTransition(async () => {
      const result = await work();
      const said = { ok: result.ok, text: result.ok ? (result.message ?? "בוצע.") : (result.error ?? "שגיאה.") };
      if (notify) notify(said);
      else setMessage(said);
    });
  }

  const fieldId = (name: string) => `deal-${deal.id}-${name}`;
  const photoHref = safePhotoHref(deal.image_url);

  return (
    <article className="px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 truncate text-base font-bold text-ink">{deal.beers?.name_he ?? "—"}</p>
        <span
          className={`shrink-0 rounded-full border border-paper-line px-2.5 py-0.5 text-xs font-semibold text-ink ${
            deal.status === "pending" ? "hatch" : ""
          }`}
        >
          {STATUS_LABEL[deal.status]}
        </span>
      </div>

      <div className="mt-1 flex items-baseline gap-2">
        <p className="min-w-0 text-sm text-ink-2">
          {CATEGORY_LABEL_ONE[deal.category]} · {deal.stores?.name_he ?? "—"}
        </p>
        <span aria-hidden className="leader-fill" />
        <Price agorot={deal.deal_price_agorot} size="sm" className="shrink-0 text-price" />
      </div>

      <p className="mt-0.5 text-sm text-ink-2">
        רגיל <span className="num">{formatPrice(deal.regular_price_agorot)}</span> ·{" "}
        <Saving pct={deal.discount_percent} className="font-semibold text-ink" />
      </p>

      {/* Who a moderator is actually judging. Before 0030 this row could not say:
          created_by was recorded but not read, and profiles is owner-only. */}
      <p className="mt-1 text-sm text-ink-2">
        {deal.entered_by_admin
          ? "נוסף ידנית על ידי מנהל"
          : deal.contributors?.display_name
            ? `דווח על ידי ${deal.contributors.display_name}`
            : deal.created_by
              ? "דווח על ידי משתמש שלא בחר שם"
              : "מקור לא ידוע"}
      </p>

      {deal.notes && <p className="mt-2 text-sm leading-relaxed text-ink-2">{deal.notes}</p>}

      {/* Defence in depth. The submission schema already pins this to the project's own
          bucket and the table has a CHECK, but this is the one place an admin CLICKS a
          value a stranger supplied, so it refuses anything that is not plainly https —
          a javascript: href executes in the current document whatever `target` says. */}
      {photoHref && (
        <a
          href={photoHref}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-1 flex min-h-11 items-center text-sm text-ink underline underline-offset-4"
        >
          צפייה בתמונה שצורפה
        </a>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {deal.status !== "approved" && (
          <button type="button" disabled={pending} onClick={() => run(() => approveDeal(deal.id))} className="btn">
            אישור
          </button>
        )}
        {deal.status === "pending" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => setDealStatus(deal.id, "rejected"))}
            className="btn btn-danger"
          >
            דחייה
          </button>
        )}
        {deal.status === "approved" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => setDealStatus(deal.id, "inactive"))}
            className="btn btn-danger"
          >
            הסרה מהאתר
          </button>
        )}
        <button
          type="button"
          aria-expanded={editing}
          onClick={() => setEditing((value) => !value)}
          className="btn btn-quiet"
        >
          {editing ? "ביטול עריכה" : "עריכה"}
        </button>
        {canDelete &&
          (confirmingDelete ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => deleteDeal(deal.id))}
                className="btn btn-danger"
              >
                כן, למחוק לצמיתות
              </button>
              <button type="button" onClick={() => setConfirmingDelete(false)} className="btn btn-quiet">
                ביטול
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmingDelete(true)} className="btn btn-quiet">
              מחיקה
            </button>
          ))}
        {canFeature && deal.status === "approved" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => setWeeklyDeal(isWeekly ? null : deal.id))}
            className="btn btn-quiet"
          >
            <SparkIcon size={18} />
            {isWeekly ? "הסרה ממבצע השבוע" : "מבצע השבוע"}
          </button>
        )}
      </div>

      {editing && (
        <form
          action={(formData) => run(() => updateDeal(deal.id, formData))}
          className="tear mt-4 space-y-3 pt-4"
        >
          <FieldRow id={fieldId("beer")} label="בירה">
            <select id={fieldId("beer")} name="beerId" defaultValue={deal.beer_id} aria-label="בירה" className="field">
              {beers.map((beer) => (
                <option key={beer.id} value={beer.id}>
                  {beer.name_he}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow id={fieldId("store")} label="חנות">
            <select id={fieldId("store")} name="storeId" defaultValue={deal.store_id} aria-label="חנות" className="field">
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name_he}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow id={fieldId("category")} label="מארז">
            <select id={fieldId("category")} name="category" defaultValue={deal.category} aria-label="מארז" className="field">
              {DEAL_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABEL[category]}
                </option>
              ))}
            </select>
          </FieldRow>
          <div className="flex gap-3">
            <FieldRow id={fieldId("dealPrice")} label="מחיר במבצע" className="flex-1">
              <input
                id={fieldId("dealPrice")}
                name="dealPrice"
                inputMode="decimal"
                defaultValue={formatAgorot(deal.deal_price_agorot)}
                aria-label="מחיר במבצע"
                className="field num text-right"
              />
            </FieldRow>
            <FieldRow id={fieldId("regularPrice")} label="מחיר רגיל" className="flex-1">
              <input
                id={fieldId("regularPrice")}
                name="regularPrice"
                inputMode="decimal"
                defaultValue={formatAgorot(deal.regular_price_agorot)}
                aria-label="מחיר רגיל"
                className="field num text-right"
              />
            </FieldRow>
          </div>
          <FieldRow id={fieldId("notes")} label="הערה">
            <input
              id={fieldId("notes")}
              name="notes"
              defaultValue={deal.notes ?? ""}
              placeholder="הערה"
              aria-label="הערה"
              className="field"
            />
          </FieldRow>
          <button type="submit" disabled={pending} className="btn w-full">
            שמירת שינויים
          </button>
        </form>
      )}

      {message && (
        <div className="mt-3">
          <Notice tone={message.ok ? "info" : "error"}>{message.text}</Notice>
        </div>
      )}
    </article>
  );
}

/** A visible label over a field; the field keeps its aria-label too. */
function FieldRow({
  id,
  label,
  className = "",
  children,
}: {
  id: string;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
    </div>
  );
}
