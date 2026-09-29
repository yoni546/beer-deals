/**
 * Builds supabase/RUN_THIS_IN_SUPABASE.sql — every migration joined in order,
 * for pasting into a *fresh* Supabase project's SQL editor.
 *
 * The file used to be concatenated by hand, which guarantees it drifts from
 * supabase/migrations/ the first time someone forgets. It is now generated, and
 * tests/migrations.test.ts fails when the committed copy is stale.
 *
 *   npm run sql:build      # rewrite the file
 *   npm run sql:check      # exit 1 if it is out of date
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "supabase", "RUN_THIS_IN_SUPABASE.sql");

const HEADER = `-- ===========================================================================
-- Beer Deals — the whole schema, in one file.   *** GENERATED — DO NOT EDIT ***
--
-- Regenerate with:  npm run sql:build     (source: supabase/migrations/*.sql)
--
-- Paste all of this into the Supabase SQL Editor and press Run, once, on a
-- FRESH project. Re-running it will complain that the types already exist,
-- which is harmless but means nothing after that point gets applied.
--
-- Existing projects: apply only the migrations you have not run yet, in order.
-- ===========================================================================
`;

export function renderCombinedSql(migrationsDir = join(ROOT, "supabase", "migrations")) {
  const files = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
  const parts = files.map((name) => {
    const body = readFileSync(join(migrationsDir, name), "utf8").replace(/\r\n/g, "\n").trim();
    return `\n-- ======================== ${name} ========================\n\n${body}\n`;
  });
  return HEADER + parts.join("");
}

export const COMBINED_SQL_PATH = OUT;

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const next = renderCombinedSql();
  if (process.argv.includes("--check")) {
    const current = readFileSync(OUT, "utf8").replace(/\r\n/g, "\n");
    if (current !== next) {
      console.error("supabase/RUN_THIS_IN_SUPABASE.sql is out of date. Run: npm run sql:build");
      process.exit(1);
    }
    console.log("supabase/RUN_THIS_IN_SUPABASE.sql is up to date.");
  } else {
    writeFileSync(OUT, next);
    console.log(`wrote ${OUT}`);
  }
}
