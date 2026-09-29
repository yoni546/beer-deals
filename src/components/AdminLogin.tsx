"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/Chrome";
import { Tape } from "@/components/ui/Tape";
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

  const label = "mb-1.5 block text-base font-bold text-ink";

  return (
    <>
      <Tape
        as="form"
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
        className="space-y-4 px-5 py-6"
      >
        <div>
          <label htmlFor="email" className={label}>
            אימייל
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="field"
            dir="ltr"
          />
        </div>

        <div>
          <label htmlFor="password" className={label}>
            סיסמה
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="field"
            dir="ltr"
          />
        </div>

        {error && <Notice>{error}</Notice>}

        <button type="submit" disabled={pending} className="btn w-full">
          {pending ? "נכנסים…" : "כניסה"}
        </button>
      </Tape>

      <p className="mt-6 text-center text-sm leading-relaxed text-on-ground-2">
        המסך הזה מיועד למנהלים בלבד. אם הגעתם לכאן בטעות, פשוט חזרו אחורה.
      </p>
    </>
  );
}
