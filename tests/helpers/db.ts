import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const ROOT = join(import.meta.dirname, "..", "..");

/**
 * A throwaway Postgres with the real migrations applied.
 *
 * The point of running the actual `supabase/migrations/*.sql` rather than a
 * hand-written test schema is that the thing under test IS the schema —
 * the constraints and the RLS policies are the security model, and a copy of
 * them would only prove the copy right.
 */
export async function freshDatabase(): Promise<PGlite> {
  const db = new PGlite();

  await db.exec(readFileSync(join(ROOT, "tests", "sql", "bootstrap.sql"), "utf8"));

  const dir = join(ROOT, "supabase", "migrations");
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, file), "utf8"));
  }

  // PostgREST grants these after every migration; without them a SET ROLE to
  // `authenticated` cannot see a table at all and every test would pass for the
  // wrong reason.
  await db.exec(`
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant select on all tables in schema public to anon;
  `);

  return db;
}

/** Creates an auth user and returns its id. */
export async function createUser(db: PGlite, email?: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    "insert into auth.users (email) values ($1) returning id",
    [email ?? null],
  );
  return result.rows[0].id;
}

/**
 * Runs `work` as a signed-in, non-superuser request — which is the only way RLS
 * is enforced at all. A superuser bypasses every policy, so a test that forgets
 * this would pass no matter what the policies said.
 */
export async function asUser<T>(
  db: PGlite,
  userId: string | null,
  work: () => Promise<T>,
  role: "authenticated" | "anon" = "authenticated",
): Promise<T> {
  await db.exec(`set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  try {
    return await work();
  } finally {
    await db.exec("reset role;");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}
