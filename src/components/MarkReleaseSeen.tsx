"use client";

import { useEffect } from "react";
import { LAST_SEEN_KEY } from "@/components/WhatsNewLink";

/** Rendered on the What's New screen: opening it counts as having read the latest release. */
export function MarkReleaseSeen({ version }: { version: string }) {
  useEffect(() => {
    try {
      window.localStorage.setItem(LAST_SEEN_KEY, version);
    } catch {
      // Storage unavailable: the dot will simply show again next time.
    }
  }, [version]);
  return null;
}
