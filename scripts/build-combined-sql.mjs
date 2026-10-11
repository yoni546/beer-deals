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
 *
 * There is also a range, for the other situation: a database that already exists
 * and needs the migrations it has not run yet, in one paste.
 *
 *   node scripts/build-combined-sql.mjs --from 0024 --to 0042 --out <path>
 *
 * The range file is NOT committed. It is cut for one database at one moment, and a
 * stale copy of "what you still need" is worse than no copy.
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
  // Same ledger note as the range file: a project built from this paste has never
  // been touched by the CLI, so without this a later `supabase db push` would offer
  // to apply all of them again. Wrapped in a handler because bookkeeping must not
  // roll back a schema that applied correctly.
  const versions = files.map((name) => name.slice(0, 4));
  const ledger = `
-- ======================== the ledger ========================

do $ledger$
begin
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (version text primary key);
  insert into supabase_migrations.schema_migrations (version)
  values ${versions.map((v) => `('${v}')`).join(", ")}
  on conflict (version) do nothing;
  raise notice 'ledger: recorded ${versions.length} migrations';
exception when others then
  raise notice 'ledger NOT recorded (%): the schema applied, but a later CLI push may offer to re-run it', sqlerrm;
end
$ledger$;
`;

  return joinSetLines(HEADER + parts.join("") + ledger);
}

/**
 * Join a line that begins with `set` onto the line before it.
 *
 * The Supabase dashboard's SQL editor cuts a submitted script immediately before
 * an indented `set` line that sits INSIDE a function body, and sends only the
 * first half. Postgres then reports "unterminated dollar-quoted string" against
 * the opening `$$`, thousands of characters earlier, which reads like a malformed
 * file and is not one. Observed twice, on two files of different sizes, cutting at
 * the same point in the content both times.
 *
 * `update x \n set a = 1` and `update x set a = 1` are the same statement — SQL
 * does not care — so this changes the text and not the meaning, and only in the
 * generated paste file. The migrations keep their formatting.
 */
export function joinSetLines(sql) {
  return sql.replace(/\n[ \t]+(set[ \t])/g, " $1");
}

export const COMBINED_SQL_PATH = OUT;

/**
 * The migrations from `from` to `to` inclusive, by their numeric prefix, as one
 * script for a database that already holds everything before `from`.
 *
 * It ends by recording itself in supabase_migrations.schema_migrations, the ledger
 * the Supabase CLI keeps. Without that line the CLI would later offer to apply
 * these again: two sources of truth about one database, which is how a schema ends
 * up half-applied.
 */
export function migrationsInRange(from, to, migrationsDir = join(ROOT, "supabase", "migrations")) {
  const all = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
  const inRange = all.filter((name) => {
    const n = name.slice(0, 4);
    return n >= from && n <= to;
  });
  if (inRange.length === 0) throw new Error(`no migrations between ${from} and ${to}`);
  return inRange;
}

/**
 * Split a list of migrations into groups no bigger than `maxBytes`. A migration is
 * never split: the largest single file sets the floor, and a group that would
 * exceed the budget starts a new one instead. Needed because the Supabase SQL
 * editor silently truncates a very large paste, and a truncated paste fails inside
 * a function body with an error that looks nothing like "too big".
 */
export function chunkMigrations(files, maxBytes, migrationsDir = join(ROOT, "supabase", "migrations")) {
  const groups = [];
  let current = [];
  let size = 0;
  for (const name of files) {
    const bytes = readFileSync(join(migrationsDir, name)).length;
    if (current.length > 0 && size + bytes > maxBytes) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(name);
    size += bytes;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

export function renderRangeSql(from, to, migrationsDir = join(ROOT, "supabase", "migrations"), only = null, part = null) {
  const inRange = only ?? migrationsInRange(from, to, migrationsDir);

  const versions = inRange.map((name) => name.slice(0, 4));
  const title = part
    ? `PART ${part.index} OF ${part.total} — migrations ${versions[0]} … ${versions[versions.length - 1]}`
    : `migrations ${versions[0]} … ${versions[versions.length - 1]}, in order`;
  const order = part
    ? `-- RUN THE PARTS IN ORDER. This is part ${part.index}; do not run it before part ${part.index - 1}.\n--\n`
    : "";
  const header = `-- ===========================================================================
-- Beer Deals — ${title}.
--     *** GENERATED, for ONE database at ONE moment — do not keep this file ***
--
${order}-- For a database that ALREADY has everything before ${versions[0]}. Paste the whole
-- thing into the SQL Editor and press Run, once. It runs in a single transaction:
-- if any statement fails, nothing is applied and the error names the line.
--
-- ${inRange.length} migrations: ${versions.join(", ")}
-- ===========================================================================

begin;
`;

  const parts = inRange.map((name) => {
    const body = readFileSync(join(migrationsDir, name), "utf8").replace(/\r\n/g, "\n").trim();
    return `\n-- ======================== ${name} ========================\n\n${body}\n`;
  });

  const ledger = `
-- ======================== the ledger ========================
--
-- Tell the Supabase CLI what was applied here, so a later \`db push\` does not offer
-- to run these a second time. Harmless on a project the CLI has never touched.
--
-- Wrapped in an exception handler on purpose. This is BOOKKEEPING: the CLI owns
-- that table and its shape has changed between CLI versions, and a surprise there
-- must not roll back nineteen migrations that applied correctly. If it cannot be
-- written it says so and the schema still lands.

do $ledger$
begin
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (version text primary key);
  insert into supabase_migrations.schema_migrations (version)
  values ${versions.map((v) => `('${v}')`).join(", ")}
  on conflict (version) do nothing;
  raise notice 'ledger: recorded ${versions.length} migrations';
exception when others then
  raise notice 'ledger NOT recorded (%): the migrations applied, but tell the owner — a later CLI push may offer to re-run them', sqlerrm;
end
$ledger$;

commit;

-- The last statement, deliberately. A paste that arrives short cannot print this,
-- so seeing it is proof the whole part was submitted — not just that no error was
-- raised by the half that arrived.
select '${part ? `PART ${part.index} OF ${part.total}` : `${versions[0]}-${versions[versions.length - 1]}`} APPLIED — migrations ${versions.join(", ")}' as done;
`;

  return joinSetLines(header + parts.join("") + ledger);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const flag = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? null : process.argv[i + 1];
  };
  const from = flag("from");
  if (from) {
    const to = flag("to") ?? "9999";
    const out = flag("out");
    if (!out) {
      console.error("--from needs --out <path>: the range file is not committed, so it needs somewhere to go");
      process.exit(2);
    }
    const chunkBytes = Number(flag("chunk-bytes") ?? 0);
    if (chunkBytes > 0) {
      // <out> is treated as a prefix: <out>-1-of-N.sql, and so on.
      const groups = chunkMigrations(migrationsInRange(from, to), chunkBytes);
      groups.forEach((group, i) => {
        const path = `${out}-${i + 1}-of-${groups.length}.sql`;
        writeFileSync(path, renderRangeSql(from, to, undefined, group, { index: i + 1, total: groups.length }));
        console.log(`wrote ${path}  (${group.length} migrations, ${Buffer.byteLength(readFileSync(path, "utf8"))} bytes)`);
      });
      process.exit(0);
    }
    writeFileSync(out, renderRangeSql(from, to));
    console.log(`wrote ${out}`);
    process.exit(0);
  }

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
