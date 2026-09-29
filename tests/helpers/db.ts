import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const ROOT = join(import.meta.dirname, "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** Applies one migration file by (prefix of) its name, e.g. "0006". */
export async function applyMigration(db: PGlite, prefix: string): Promise<void> {
  const file = migrationFiles().find((name) => name.startsWith(prefix));
  if (!file) throw new Error(`no migration starting with ${prefix}`);
  await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
}

/**
 * A throwaway Postgres with the real migrations applied.
 *
 * The point of running the actual `supabase/migrations/*.sql` rather than a
 * hand-written test schema is that the thing under test IS the schema —
 * the constraints and the RLS policies are the security model, and a copy of
 * them would only prove the copy right.
 *
 * `through` stops after the migration whose name starts with that prefix, so a
 * test can build the state production was in, add data, and then apply the next
 * migration to see what it does to real rows.
 */
export async function freshDatabase(options: { through?: string } = {}): Promise<PGlite> {
  const db = new PGlite();

  await db.exec(readFileSync(join(ROOT, "tests", "sql", "bootstrap.sql"), "utf8"));

  for (const file of migrationFiles()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    if (options.through && file.startsWith(options.through)) break;
  }

  // Deliberately no blanket grant here. The migrations grant each table exactly
  // the verbs it needs, and the tests run against those — so a grant that is
  // missing in production is missing here too, and the suite says so.
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
  role: "authenticated" | "anon" | "service_role" = "authenticated",
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
