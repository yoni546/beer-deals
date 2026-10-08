"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Notice } from "@/components/Chrome";
import { Tape } from "@/components/ui/Tape";
import { unfollowBeer } from "@/lib/actions/watchlist";
import { formatAgorot } from "@/lib/money";

/**
 * What this person is following (migration 0037), on Settings.
 *
 * Only a list and a way out. Changing a price is done on the beer's own page,
 * beside its prices, which is where somebody can actually see whether the number
 * they are about to type is a good one — a bare input on a settings screen asks
 * them to guess.
 */
export function WatchlistEditor({
  rows,
}: {
  rows: Array<{ beerId: string; slug: string; nameHe: string; maxPriceAgorot: number | null }>;
}) {
  const [following, setFollowing] = useState(rows);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function drop(beerId: string) {
    startTransition(async () => {
      const result = await unfollowBeer(beerId);
      setMessage({ ok: result.ok, text: result.ok ? (result.message ?? "בוצע.") : result.error });
      if (result.ok) setFollowing((list) => list.filter((row) => row.beerId !== beerId));
    });
  }

  // The message is rendered OUTSIDE the branch, not inside the list. Removing the
  // last beer takes the list away, and a confirmation that lives inside the thing
  // the action destroys is never seen — the same bug the admin rows had (0.21.1).
  return (
    <div className="space-y-2">
      {following.length === 0 ? (
        <p className="text-sm leading-relaxed text-on-ground-2">
          אינכם עוקבים אחרי בירה. בדף של כל בירה יש ״עקבו אחרי…״ — אפשר גם לקבוע מחיר שבו נודיע לכם.
        </p>
      ) : (
      <Tape as="ul" className="divide-y divide-dotted divide-paper-line">
        {following.map((row) => (
          <li key={row.beerId} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <Link href={`/beer/${row.slug}`} className="text-base font-bold text-ink">
                {row.nameHe}
              </Link>
              <p className="text-sm text-ink-2">
                {row.maxPriceAgorot ? (
                  <>
                    נודיע מתחת ל<span className="num">{formatAgorot(row.maxPriceAgorot)}</span> ₪
                  </>
                ) : (
                  "נודיע על מבצע חזק"
                )}
              </p>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => drop(row.beerId)}
              className="btn btn-quiet shrink-0"
            >
              הסרה
            </button>
          </li>
        ))}
      </Tape>
      )}
      {message && <Notice tone={message.ok ? "info" : "error"}>{message.text}</Notice>}
    </div>
  );
}
