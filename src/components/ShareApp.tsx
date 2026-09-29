"use client";

import { useState } from "react";

/**
 * The address people are sent to. Always the production app — never the address this page happens to
 * be served from (a staging or preview build, or localhost on a developer's machine).
 */
export const PRODUCTION_URL = "https://beer-deals.vercel.app";

const SHARE = { title: "מבצעי בירה", text: "מבצעי שישיות וארגזים על הבירות שלך", url: PRODUCTION_URL };

/**
 * "אהבתם? שתפו לחברים": the phone's own share sheet where there is one (Web Share API); elsewhere the
 * link is copied and the button says so. If even copying is refused, the address is shown to copy by hand.
 */
export function ShareApp({ className = "" }: { className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");

  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share(SHARE);
        return;
      } catch (error) {
        // Closing the share sheet is a choice, not a failure.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(PRODUCTION_URL);
      setState("copied");
    } catch {
      setState("manual");
    }
  }

  return (
    <div className={className}>
      <button type="button" onClick={share} className="btn btn-ghost w-full">
        אהבתם? שתפו לחברים
      </button>
      <p role="status" className="mt-1 min-h-5 text-center text-sm text-on-ground-2">
        {state === "copied" && "הקישור הועתק"}
        {state === "manual" && (
          <>
            העתיקו את הקישור: <span className="num select-all">{PRODUCTION_URL}</span>
          </>
        )}
      </p>
    </div>
  );
}
