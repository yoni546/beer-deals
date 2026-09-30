/**
 * Which database an ingestion script writes to, proven before a single row is written.
 *
 *   --target staging                                  reads .env.staging.local
 *   --target production --confirm-ref <project ref>   reads .env.production.local
 *
 * Both files are git-ignored and hold only that environment's values (never one copied from the other).
 * Production is refused unless ALL of these hold:
 *   - the file says APP_ENV=production;
 *   - its Supabase URL is a *.supabase.co project, and that project ref is exactly the one typed on the
 *     command line (--confirm-ref) — the operator reads it off the Supabase dashboard, it is never guessed;
 *   - that ref is not the staging project.
 * Staging is refused if its file points at the production project or does not say APP_ENV=staging.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The staging project (docs/STAGING.md). Never a production target. */
export const STAGING_REF = "qpjwnxptitnmtsznjvkw";
/** The production project as the repository's docs record it (docs/for-collaborators.md). Never a staging target. */
export const KNOWN_PRODUCTION_REFS = ["itpyyexhmvosxcbcagvy"];

export const ENV_FILES = { staging: ".env.staging.local", production: ".env.production.local" };

/** The project ref of a Supabase URL, or null. */
export const refOf = (url) => (String(url ?? "").match(/^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/) ?? [])[1] ?? null;

export function parseEnvFile(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^"(.*)"$/, "$1")]),
  );
}

/**
 * The pure rule (unit-tested): returns { target, ref } or throws an Error that says what is wrong.
 * @param {{ target: string, env: Record<string, string>, confirmRef?: string }} input
 */
export function checkTarget({ target, env, confirmRef = "" }) {
  if (target !== "staging" && target !== "production") {
    throw new Error("pass --target staging, or --target production --confirm-ref <production project ref>");
  }
  const file = ENV_FILES[target];
  const ref = refOf(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!ref) throw new Error(`${file}: NEXT_PUBLIC_SUPABASE_URL is not a https://<ref>.supabase.co address`);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error(`${file}: SUPABASE_SERVICE_ROLE_KEY is missing`);

  if (target === "staging") {
    if (env.APP_ENV !== "staging") throw new Error(`${file}: APP_ENV must be "staging"`);
    if (KNOWN_PRODUCTION_REFS.includes(ref)) throw new Error(`${file} points at the PRODUCTION project (${ref})`);
    return { target, ref };
  }

  if (env.APP_ENV !== "production") throw new Error(`${file}: APP_ENV must be "production"`);
  if (ref === STAGING_REF) throw new Error(`${file} points at the STAGING project (${STAGING_REF}) — production and staging are never the same`);
  if (!confirmRef) throw new Error(`production needs --confirm-ref <ref>: type the production project ref from the Supabase dashboard (this file points at ${ref})`);
  if (confirmRef !== ref) throw new Error(`--confirm-ref ${confirmRef} does not match ${file}, which points at ${ref}`);
  return { target, ref };
}

/** Reads the target's env file and proves it (process exits on a refusal). */
export function loadTarget(root, args) {
  const flag = (name) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? "" : (args[i + 1] ?? "");
  };
  const target = flag("target");
  const file = ENV_FILES[target];
  try {
    if (!file) checkTarget({ target, env: {} });
    const path = join(root, file);
    if (!existsSync(path)) throw new Error(`${file} not found (docs/${target === "staging" ? "STAGING.md" : "PRODUCTION-HANDOFF-YONI.md"})`);
    const env = parseEnvFile(readFileSync(path, "utf8"));
    const { ref } = checkTarget({ target, env, confirmRef: flag("confirm-ref") });
    console.log(`target: ${target.toUpperCase()} · Supabase project ${ref}${target === "production" ? ` (staging is ${STAGING_REF})` : ""}`);
    return { target, ref, env, url: env.NEXT_PUBLIC_SUPABASE_URL };
  } catch (error) {
    console.error(`Refusing: ${error.message}`);
    process.exit(1);
  }
}
