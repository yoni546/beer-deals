/**
 * Which environment is this, and is it wired to the LIVE database?
 *
 * Until a staging project existed, "run it locally" meant "run it against the
 * production database" (docs/for-collaborators.md said so). One approved deal on a
 * laptop was an approved deal for every real user. This makes the situation
 * visible on screen: non-production environments show a badge, and any
 * non-production environment that points at the production project shows a
 * warning. It changes nothing in production.
 */

/** The production Supabase project (public: it is in the site's own URLs and docs). */
export const PRODUCTION_SUPABASE_REF = "itpyyexhmvosxcbcagvy";

export type EnvironmentName = "production" | "staging" | "preview" | "development" | "test";

export type EnvironmentInfo = {
  name: EnvironmentName;
  /** True when this build is talking to the production database. */
  usesProductionDatabase: boolean;
};

type Env = Record<string, string | undefined>;

export function describeEnvironment(env: Env = process.env): EnvironmentInfo {
  // APP_ENV is explicit and wins; Vercel's own label is the fallback.
  const declared = (env.APP_ENV ?? env.VERCEL_ENV ?? "").toLowerCase();
  const name: EnvironmentName =
    declared === "production" || declared === "staging" || declared === "preview" || declared === "test"
      ? declared
      : "development";

  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return { name, usesProductionDatabase: url.includes(PRODUCTION_SUPABASE_REF) };
}
