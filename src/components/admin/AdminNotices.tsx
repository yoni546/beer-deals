"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Notice } from "@/components/Chrome";

/**
 * Where the result of an admin action is shown.
 *
 * THE BUG THIS EXISTS FOR. Every row action reported its result INSIDE the row.
 * That works for an edit and for nothing else: approving a deal moves it from
 * "ממתינים" to "מאושרים", and removing one takes it off the page — so the server
 * re-render unmounts the row, and the sentence it was about to show goes with it.
 * An administrator pressing "הסרה מהאתר" saw the deal disappear and no
 * confirmation at all, which on a destructive action is the worst possible
 * outcome: you cannot tell "it worked" from "nothing happened, press it again".
 * The e2e found it as an intermittent failure, because whether the notice painted
 * before the revalidation landed was a race.
 *
 * So the notice lives above the list, outside everything an action can unmount,
 * and stays for long enough to read. It is a polite live region — `role="status"`
 * for a success, `role="alert"` for a failure (Notice decides) — so a screen
 * reader hears the outcome of a button that no longer exists.
 */

type Notify = (message: { ok: boolean; text: string }) => void;

const AdminNoticeContext = createContext<Notify | null>(null);

/**
 * How long a confirmation stays. Long enough to read a sentence and look up at
 * what changed, short enough that it is never mistaken for the result of the NEXT
 * thing you press. A failure does not expire: it needs acting on.
 */
const LINGER_MS = 8000;

export function AdminNotices({ children }: { children: React.ReactNode }) {
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback<Notify>((next) => {
    if (timer.current) clearTimeout(timer.current);
    setNotice(next);
    if (next.ok) {
      timer.current = setTimeout(() => setNotice(null), LINGER_MS);
    }
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <AdminNoticeContext.Provider value={notify}>
      {/* Always in the tree, even when empty: a live region that is added to the
          document at the same moment as its text is not announced by every reader. */}
      <div aria-live="polite" className="sticky top-0 z-10 empty:hidden">
        {notice && (
          <div className="px-4 pt-3">
            <Notice tone={notice.ok ? "info" : "error"}>
              {notice.text}
              {!notice.ok && " "}
              {!notice.ok && (
                <button
                  type="button"
                  onClick={() => setNotice(null)}
                  className="underline underline-offset-4"
                >
                  סגירה
                </button>
              )}
            </Notice>
          </div>
        )}
      </div>
      {children}
    </AdminNoticeContext.Provider>
  );
}

/**
 * Report the result of an action.
 *
 * Returns null outside the provider, and every caller falls back to showing the
 * message in place. A row that can only be reached through the panel will always
 * have it; this keeps the components usable in a test or a page that does not.
 */
export function useAdminNotice(): Notify | null {
  return useContext(AdminNoticeContext);
}
