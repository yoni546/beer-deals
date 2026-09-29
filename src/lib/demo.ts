/**
 * Sample ("demo") deals must never be presented as real prices.
 *
 * They were seeded into production once (supabase/MAKE_ME_ADMIN.sql) and shown
 * to real users under a "deal of the week" trophy. Two independent guards now
 * keep that from happening again:
 *
 *   1. migration 0006 takes existing sample rows out of the public view, and
 *   2. this module: a production server refuses to read them at all, whatever
 *      the database contains — so re-running a seed by mistake cannot bring
 *      them back.
 *
 * Sample rows are identified by an exact note (the convention the seed scripts
 * already used). Staging and development keep showing them, on purpose.
 */
export const DEMO_DEAL_NOTE = "מבצע לדוגמה";

type Env = Record<string, string | undefined>;

/** `APP_ENV` wins so any host can opt in; Vercel sets `VERCEL_ENV` by itself. */
export function isProductionEnvironment(env: Env = process.env): boolean {
  return (env.APP_ENV ?? env.VERCEL_ENV) === "production";
}

/**
 * PostgREST `or()` filter keeping every real deal and dropping sample rows.
 * `notes` is optional, so "is null" has to be spelled out: a plain `neq` would
 * also discard every deal that has no note.
 */
export const WITHOUT_DEMO_DEALS = `notes.is.null,notes.neq."${DEMO_DEAL_NOTE}"`;
