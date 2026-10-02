"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { publicEnv } from "@/lib/env";

/**
 * Forgotten admin password, in two halves of one page.
 *
 * Arriving with no recovery code, you ask for the email. Arriving from the link
 * in that email, the code is in the URL and you set a new password. One page,
 * because the second half is useless to reach on purpose and the first is the
 * only way to reach it.
 *
 * The outcome of asking is deliberately the same whether or not the address has
 * an account: "if there is an account, an email is on the way". Saying "no such
 * admin" would let anyone discover who the admins are.
 */
export function AdminPasswordReset() {
  const router = useRouter();
  const [stage, setStage] = useState<"checking" | "ask" | "set">("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const supabase = supabaseBrowser();

    // The recovery link arrives either as ?code= (PKCE) or as a #access_token
    // fragment, depending on how Supabase is configured. A server never sees a
    // fragment, which is why this part has to run in the browser.
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const isRecovery = fragment.get("type") === "recovery" || Boolean(code);

    if (!isRecovery) {
      setStage("ask");
      return;
    }

    (async () => {
      try {
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        }
        // With a fragment, the client picks the session up by itself on load.
        setStage("set");
        // Keep the token out of the address bar and out of any screenshot.
        window.history.replaceState({}, "", "/admin/reset");
      } catch {
        setError("הקישור כבר לא תקף. בקשו קישור חדש.");
        setStage("ask");
      }
    })();
  }, []);

  const field =
    "w-full rounded-2xl border border-paper-line bg-paper px-4 py-3.5 text-ink outline-none focus:border-ink";

  if (stage === "checking") return null;

  if (stage === "ask") {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          startTransition(async () => {
            const supabase = supabaseBrowser();
            await supabase.auth.resetPasswordForEmail(email.trim(), {
              redirectTo: `${publicEnv.siteUrl}/admin/reset`,
            });
            // Shown whatever happened, on purpose: see the note above.
            setSent(true);
          });
        }}
        className="space-y-3"
      >
        <p className="text-sm leading-relaxed text-ink-2">
          נשלח קישור לאיפוס סיסמה לכתובת המייל של המנהל.
        </p>

        <label htmlFor="email" className="block text-sm font-bold text-ink">
          אימייל
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="username"
          dir="ltr"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={field}
        />

        {error && <p className="text-sm text-danger">{error}</p>}

        {sent ? (
          <div className="rounded-2xl border border-paper-line bg-paper p-4">
            <p className="text-sm font-bold text-ink">אם קיים חשבון עם הכתובת הזו, הקישור בדרך.</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-2">
              בדקו גם בספאם. הקישור תקף לשעה. אם לא הגיע כלום תוך כמה דקות, ייתכן שנגמרה מכסת
              המיילים של היום — נסו שוב מאוחר יותר.
            </p>
          </div>
        ) : (
          <button type="submit" disabled={pending} className="btn w-full">
            {pending ? "שולחים…" : "שליחת קישור"}
          </button>
        )}
      </form>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);

        if (password.length < 8) {
          setError("הסיסמה צריכה להיות באורך 8 תווים לפחות.");
          return;
        }
        if (password !== confirm) {
          setError("שתי הסיסמאות לא זהות.");
          return;
        }

        startTransition(async () => {
          const supabase = supabaseBrowser();
          const { error: updateError } = await supabase.auth.updateUser({ password });
          if (updateError) {
            setError("לא הצלחנו לעדכן את הסיסמה. בקשו קישור חדש ונסו שוב.");
            return;
          }
          router.replace("/admin");
          router.refresh();
        });
      }}
      className="space-y-3"
    >
      <p className="text-sm leading-relaxed text-ink-2">בחרו סיסמה חדשה.</p>

      <label htmlFor="password" className="block text-sm font-bold text-ink">
        סיסמה חדשה
      </label>
      <input
        id="password"
        type="password"
        required
        autoComplete="new-password"
        dir="ltr"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        className={field}
      />

      <label htmlFor="confirm" className="block text-sm font-bold text-ink">
        שוב, לוודא
      </label>
      <input
        id="confirm"
        type="password"
        required
        autoComplete="new-password"
        dir="ltr"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        className={field}
      />

      {error && <p className="text-sm text-danger">{error}</p>}

      <button type="submit" disabled={pending} className="btn w-full">
        {pending ? "שומרים…" : "שמירה וכניסה"}
      </button>
    </form>
  );
}
