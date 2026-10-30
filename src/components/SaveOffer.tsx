"use client";

import { useEffect, useState } from "react";
import { BookmarkIcon } from "@/components/ui/icons";
import { SAVED_COOKIE, parseSaved, serializeSaved, toggleSaved } from "@/lib/saved";

const readCookie = () => {
  const entry = document.cookie.split("; ").find((part) => part.startsWith(`${SAVED_COOKIE}=`));
  return parseSaved(entry?.slice(SAVED_COOKIE.length + 1));
};

const writeCookie = (keys: string[]) => {
  // A year, the whole site, and never sent to anybody else's site.
  document.cookie = `${SAVED_COOKIE}=${encodeURIComponent(serializeSaved(keys))}; Path=/; Max-Age=31536000; SameSite=Lax`;
};

/**
 * "Save this deal" on any offer line (src/lib/saved.ts says where it is kept).
 *
 * Rendered unsaved on the server and corrected after mount, because the server
 * render of a deal line is shared by everybody and must not depend on a cookie.
 * The state is said in words as well as by the filled mark — never by the icon alone.
 */
export function SaveOffer({ offerKey }: { offerKey: string }) {
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSaved(readCookie().includes(offerKey));
  }, [offerKey]);

  function toggle() {
    const next = toggleSaved(readCookie(), offerKey);
    writeCookie(next);
    setSaved(next.includes(offerKey));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      data-save-offer
      className="save-offer inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-ink-2"
    >
      <BookmarkIcon size={18} filled={saved} />
      {saved ? "נשמר" : "שמירה"}
    </button>
  );
}
