/**
 * Environment access, split by where it is allowed to be read.
 *
 * The public half is read through `process.env.NEXT_PUBLIC_*` literals so Next
 * can inline them at build time — a computed lookup like `process.env[name]`
 * silently produces `undefined` in the browser bundle.
 */

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env.local and fill it in (see docs/setup.md).`,
    );
  }
  return value;
}

export const publicEnv = {
  supabaseUrl: required(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: required(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ),
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
};

/**
 * Server-only secrets. Reading this from a Client Component throws at build
 * time via `server-only`, rather than leaking the service role key into a
 * JavaScript bundle that anyone can read.
 */
export function serverEnv() {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv() was called in the browser");
  }
  return {
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? "",
    vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:admin@example.com",
  };
}
