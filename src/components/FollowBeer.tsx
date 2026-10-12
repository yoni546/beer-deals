"use client";

import { useState, useTransition } from "react";
import { Notice } from "@/components/Chrome";
import { followBeer, unfollowBeer } from "@/lib/actions/watchlist";
import { formatAgorot, shekelsToAgorot } from "@/lib/money";

/**
 * "Tell me when this one is cheap" (migration 0037).
 *
 * Favourites #1–#4 shape the app and only #1 reaches a phone, on purpose. This is
 * the other thing somebody wants: a beer they are not reorganising their app
 * around, at a price they would actually act on.
 *
 * The price is OPTIONAL and the copy says what each choice means, because the two
 * are genuinely different promises: a number means "at or under this", and empty
 * means "whatever counts as a strong deal", which is the same rule as their
 * number one. Promising something vaguer than that would be worse than asking.
 *
 * It holds a local snapshot of what is on record: a client component's props do
 * not come back changed after the action revalidates (the same thing that bit
 * LocationEditor and CreditEditor).
 */
export function FollowBeer({
  beerId,
  beerName,
  watching,
}: {
  beerId: string;
  beerName: string;
  /** What is on record now: null when not following. */
  watching: { maxPriceAgorot: number | null } | null;
}) {
  const [onRecord, setOnRecord] = useState(watching);
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(
    watching?.maxPriceAgorot ? formatAgorot(watching.maxPriceAgorot) : "",
  );
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function run(work: () => Promise<{ ok: boolean; message?: string; error?: string }>, next: typeof onRecord) {
    startTransition(async () => {
      const result = await work();
      setMessage({ ok: result.ok, text: result.ok ? (result.message ?? "בוצע.") : (result.error ?? "שגיאה.") });
      if (result.ok) {
        setOnRecord(next);
        setOpen(false);
      }
    });
  }

  return (
    <section aria-label="מעקב" className="space-y-2">
      {onRecord ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-sm text-on-ground-2">
            {onRecord.maxPriceAgorot
              ? <>עוקבים · נודיע מתחת ל<span className="num">{formatAgorot(onRecord.maxPriceAgorot)}</span> ₪</>
              : "עוקבים · נודיע על מבצע חזק"}
          </p>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="min-h-11 text-sm font-semibold text-on-ground underline underline-offset-4"
          >
            {open ? "ביטול" : "שינוי המחיר"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => unfollowBeer(beerId), null)}
            className="min-h-11 text-sm font-semibold text-on-ground-2 underline underline-offset-4"
          >
            להפסיק לעקוב
          </button>
        </div>
      ) : (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="btn btn-ghost min-h-11 w-full"
        >
          עקבו אחרי {beerName}
        </button>
      )}

      {open && (
        <div className="space-y-2 rounded-2xl border border-ground-line p-3">
          <label htmlFor={`follow-${beerId}`} className="block text-sm font-bold text-on-ground">
            להודיע לי כשהמחיר מתחת ל־ (רשות)
          </label>
          <input
            id={`follow-${beerId}`}
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            inputMode="decimal"
            placeholder="24.90"
            className="field num text-right"
          />
          <p className="text-sm leading-relaxed text-on-ground-2">
            בלי מחיר — נודיע לכם על מבצע חזק, לפי אותם כללים של הבירה הראשית שלכם. ההתראות עצמן לא
            משתנות: אותה הגבלה יומית, אותה שעת שקט.
          </p>
          <button
            type="button"
            disabled={pending}
            // The snapshot is only applied when the action succeeded, so parsing the
            // same string here cannot disagree with what was saved.
            onClick={() => run(() => followBeer(beerId, price), { maxPriceAgorot: shekelsToAgorot(price) })}
            className="btn w-full"
          >
            שמירה
          </button>
        </div>
      )}

      {message && <Notice tone={message.ok ? "info" : "error"}>{message.text}</Notice>}
    </section>
  );
}
