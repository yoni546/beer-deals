import { describe, expect, it } from "vitest";
import { freshDatabase } from "./helpers/db";

/**
 * Every write inside a function says WHERE.
 *
 * Supabase runs the `safeupdate` guard on the role behind the API: an UPDATE or
 * DELETE arriving through PostgREST without a filter is refused, not run. The
 * guard holds for the whole session, so it applies inside a SECURITY DEFINER
 * function too — a function with an unqualified DELETE in it cannot be called
 * through `db.rpc(...)` at all.
 *
 * That is not a theory. 0044's `delete from public.offers_catalog;` meant twelve
 * days of imports that wrote every price correctly and then failed, in one
 * logged line, to publish them, while the app told its owner the prices were
 * eight days old. 0055 added the predicate.
 *
 * PGlite has no safeupdate, so no test here can reproduce the refusal. This
 * reads the built schema instead — the functions as they END UP, after every
 * `create or replace` — which is why it cannot be fooled by a later migration
 * that fixes an earlier one, or by one that breaks it again.
 */
describe("functions that write say WHERE", () => {
  it("has no unqualified DELETE or UPDATE in any function body", async () => {
    const db = await freshDatabase();
    const { rows } = await db.query<{ name: string; body: string }>(
      `select p.proname as name, p.prosrc as body
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         join pg_language l on l.oid = p.prolang
        where n.nspname = 'public' and l.lanname in ('plpgsql', 'sql')`,
    );

    const offenders: string[] = [];
    for (const { name, body } of rows) {
      for (const statement of body.replace(/--[^\n]*/g, "").split(";")) {
        const flat = statement.replace(/\s+/g, " ").trim();
        if (/^(delete from|update )/i.test(flat) && !/\bwhere\b/i.test(flat)) {
          offenders.push(`${name}: ${flat.slice(0, 80)}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
