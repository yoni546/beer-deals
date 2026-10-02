import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDatabase } from "./helpers/db";

/**
 * A view must not be an accidental hole in row level security.
 *
 * A SECURITY DEFINER view runs with its creator's privileges, so the policies on
 * the tables underneath do not apply to whoever reads through it. That is
 * sometimes exactly what is wanted and usually a mistake, and the difference has
 * to be written down rather than remembered.
 *
 * Supabase's own linter flags every DEFINER view. This test is the answer to it:
 * each one is either invoker, or named below with the reason it is not.
 */

/**
 * The deliberate exceptions.
 *
 * `promotion_branches` answers "which branches is this promotion running at?",
 * and to do that it joins `branch_scans` — scan bookkeeping that is granted to
 * `authenticated` and `service_role` but deliberately NOT to `anon`. As an
 * invoker view it raises `permission denied for table branch_scans` for exactly
 * the anonymous visitors the app is built for.
 *
 * So the view IS the boundary: it exposes promotion id, branch id, branch name,
 * city and observation time, and no scan status, file name or scan id. Granting
 * `anon` the underlying table to satisfy the linter would widen the surface to
 * fix something that is not broken.
 */
const DELIBERATE_DEFINER_VIEWS = new Set(["promotion_branches"]);

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
});

afterAll(async () => {
  await db?.close();
});

describe("public views", () => {
  it("runs as the caller, unless it is a documented exception", async () => {
    const { rows } = await db.query<{ view: string; invoker: boolean }>(`
      select c.relname as view,
             coalesce(
               -- Postgres stores the literal that was written, so this is 'on'
               -- here and could be 'true' elsewhere. Comparing against one
               -- spelling is how the first version of this check reported every
               -- view as DEFINER when seven of eight were already fine.
               (select lower(option_value) in ('true', 'on', '1')
                  from pg_options_to_table(c.reloptions)
                 where option_name = 'security_invoker'),
               false
             ) as invoker
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'v'
       order by c.relname
    `);

    expect(rows.length).toBeGreaterThan(0);

    const unexpected = rows
      .filter((row) => !row.invoker && !DELIBERATE_DEFINER_VIEWS.has(row.view))
      .map((row) => row.view);

    expect(
      unexpected,
      `these views bypass row level security without a recorded reason: ${unexpected.join(", ")}. ` +
        "Either add `security_invoker = on`, or add it to DELIBERATE_DEFINER_VIEWS with why.",
    ).toEqual([]);
  });

  it("keeps the exception list honest — nothing stale in it", async () => {
    // An exception that has since been fixed should be removed from the list,
    // or the list stops meaning anything.
    const { rows } = await db.query<{ view: string }>(`
      select c.relname as view
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'v'
         and coalesce((select lower(option_value) in ('true','on','1')
                         from pg_options_to_table(c.reloptions)
                        where option_name = 'security_invoker'), false)
    `);

    const nowInvoker = rows.map((row) => row.view).filter((view) => DELIBERATE_DEFINER_VIEWS.has(view));
    expect(nowInvoker, "these are listed as deliberate exceptions but are now invoker views").toEqual([]);
  });

  it("still lets an anonymous visitor read the public feeds", async () => {
    for (const view of ["deals_public", "offers_feed", "offers_ranked", "promotions_current"]) {
      await expect(
        asUser(db, null, () => db.query(`select * from public.${view} limit 1`), "anon"),
        `anon can no longer read ${view}`,
      ).resolves.toBeDefined();
    }
  });

  it("hides an unapproved deal from an anonymous visitor", async () => {
    const beer = await db.query<{ id: string }>("select id from public.beers limit 1");
    const store = await db.query<{ id: string }>("select id from public.stores limit 1");

    await db.query(
      `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status)
       values ($1, $2, 'sixpack', 2490, 3990, 'pending')`,
      [beer.rows[0].id, store.rows[0].id],
    );

    const seen = await asUser(db, null, () => db.query("select id from public.deals_public"), "anon");
    expect(seen.rows).toHaveLength(0);
  });
});
