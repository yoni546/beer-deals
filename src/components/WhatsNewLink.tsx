"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { isUnseen } from "@/lib/versions";

export const LAST_SEEN_KEY = "bd_last_seen_release";

/** Reads the last release this browser has looked at. Storage can throw (private mode). */
export function readLastSeen(): string | null {
  try {
    return window.localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

/**
 * A small, quiet entry to the update history. It never opens by itself; the dot
 * only says "there is something you have not read", and it goes away once the
 * What's New screen has been opened (see MarkReleaseSeen).
 */
export function WhatsNewLink({
  latestVersion,
  className = "",
}: {
  /** The newest release shown in the app (from the server; see src/lib/releases.ts). */
  latestVersion: string | null;
  className?: string;
}) {
  // Unknown on the server and on first paint, so the dot cannot cause a hydration mismatch.
  const [unseen, setUnseen] = useState(false);

  useEffect(() => {
    setUnseen(isUnseen(readLastSeen(), latestVersion));
  }, [latestVersion]);

  return (
    <Link
      href="/whats-new"
      className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-2.5 text-sm font-semibold underline underline-offset-4 ${className}`}
    >
      {unseen && (
        <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-deal" data-testid="whats-new-dot" />
      )}
      מה חדש
      {unseen && <span className="sr-only"> — יש עדכון חדש</span>}
    </Link>
  );
}
