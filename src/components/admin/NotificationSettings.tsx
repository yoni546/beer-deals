"use client";

import { useActionState } from "react";
import { Notice } from "@/components/Chrome";
import { Tape } from "@/components/ui/Tape";
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

  const field = "field num text-right";
  const label = "mb-1.5 block text-base font-bold text-ink";

  return (
    <Tape className="px-5 py-6">
      <form action={submit} className="space-y-5">
        <div>
          <label htmlFor="minDiscount" className={label}>
            הנחה מינימלית להתראה (%)
          </label>
          <input
            id="minDiscount"
            name="minDiscount"
            type="number"
            min={0}
            max={100}
            defaultValue={settings.notify_min_discount_percent}
            className={field}
          />
        </div>

        <div>
          <label htmlFor="maxPrice" className={label}>
            מחיר מקסימלי להתראה (₪)
          </label>
          <input
            id="maxPrice"
            name="maxPrice"
            inputMode="decimal"
            defaultValue={formatAgorot(settings.notify_max_price_agorot)}
            className={field}
          />
        </div>

        <div>
          <label htmlFor="cooldownHours" className={label}>
            מרווח מינימלי בין התראות לאותו משתמש (שעות)
          </label>
          <input
            id="cooldownHours"
            name="cooldownHours"
            type="number"
            min={0}
            defaultValue={settings.notify_cooldown_hours}
            className={field}
          />
        </div>

        <p className="text-sm leading-relaxed text-ink-2">
          התראה נשלחת רק אם המבצע עומד בשני התנאים, ורק למי שזו הבירה הראשית שלו.
        </p>

        {!state.ok && <Notice>{state.error}</Notice>}
        {state.ok && state.message && <Notice tone="info">{state.message}</Notice>}

        <button type="submit" disabled={pending} className="btn w-full">
          {pending ? "שומרים…" : "שמירה"}
        </button>
      </form>
    </Tape>
  );
}
