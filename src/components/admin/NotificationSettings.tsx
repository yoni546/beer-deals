"use client";

import { useActionState } from "react";
import { updateNotificationSettings } from "@/lib/actions/admin";
import { IDLE } from "@/lib/actions/result";
import { formatAgorot } from "@/lib/money";
import type { AppSettings } from "@/lib/db/types";

/**
 * What counts as a deal worth interrupting someone for.
 *
 * Both thresholds must be met, not either: a 60% discount on a ₪90 case is not
 * the same kind of news as a 30% discount on a ₪24 sixpack, and a phone buzzing
 * in the evening should mean something the person can act on tonight.
 */
export function NotificationSettings({ settings }: { settings: AppSettings }) {
  const [state, submit, pending] = useActionState(updateNotificationSettings, IDLE);

  const field = "w-full rounded-2xl bg-[color:var(--surface)] px-4 py-3 text-sm ring-1 ring-white/10 outline-none";

  return (
    <form action={submit} className="space-y-4">
      <div>
        <label htmlFor="minDiscount" className="mb-1 block text-sm font-bold">
          הנחה מינימלית להתראה (%)
        </label>
        <input
          id="minDiscount"
          name="minDiscount"
          type="number"
          min={0}
          max={100}
          defaultValue={settings.notify_min_discount_percent}
          className={`${field} num`}
        />
      </div>

      <div>
        <label htmlFor="maxPrice" className="mb-1 block text-sm font-bold">
          מחיר מקסימלי להתראה (₪)
        </label>
        <input
          id="maxPrice"
          name="maxPrice"
          inputMode="decimal"
          defaultValue={formatAgorot(settings.notify_max_price_agorot)}
          className={`${field} num`}
        />
      </div>

      <div>
        <label htmlFor="cooldownHours" className="mb-1 block text-sm font-bold">
          מרווח מינימלי בין התראות לאותו משתמש (שעות)
        </label>
        <input
          id="cooldownHours"
          name="cooldownHours"
          type="number"
          min={0}
          defaultValue={settings.notify_cooldown_hours}
          className={`${field} num`}
        />
      </div>

      <p className="text-xs opacity-50">
        התראה נשלחת רק אם המבצע עומד בשני התנאים, ורק למי שזו הבירה הראשית שלו.
      </p>

      {!state.ok && <p className="text-sm text-red-300">{state.error}</p>}
      {state.ok && state.message && (
        <p className="text-sm text-[color:var(--accent)]">{state.message}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-2xl bg-[color:var(--accent)] px-4 py-3 text-sm font-bold text-[color:var(--base)] disabled:opacity-40"
      >
        {pending ? "שומרים…" : "שמירה"}
      </button>
    </form>
  );
}
