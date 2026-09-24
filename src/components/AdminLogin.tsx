"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Admin sign-in.
 *
 * Everyone browses as an anonymous user; signing in here replaces that session
 * with a real, named one. Whether that account is actually an admin is not
 * decided here at all — it is decided by a row in public.admins, which only a
 * super admin can write. This form just proves who you are.
 */
export function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const field =
    "w-full rounded-2xl bg-[color:var(--surface)] px-4 py-3.5 ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-[color:var(--accent)]";

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const supabase = supabaseBrowser();
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });

          if (signInError) {
            // Deliberately one message for both a wrong password and an unknown
            // address: distinguishing them tells a stranger which emails have
            // accounts here.
            setError("האימייל או הסיסמה לא נכונים.");
            return;
          }

          router.replace("/admin");
          router.refresh();
        });
      }}
      className="space-y-3"
    >
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-bold">
          אימייל
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={field}
          dir="ltr"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-bold">
          סיסמה
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={field}
          dir="ltr"
        />
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-2xl bg-[color:var(--accent)] px-4 py-3.5 font-bold text-[color:var(--base)] disabled:opacity-40"
      >
        {pending ? "נכנסים…" : "כניסה"}
      </button>

      <p className="pt-2 text-center text-xs opacity-45">
        המסך הזה מיועד למנהלים בלבד. אם הגעתם לכאן בטעות, פשוט חזרו אחורה.
      </p>
    </form>
  );
}
