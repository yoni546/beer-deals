import { describe, expect, it } from "vitest";
import { freshDatabase } from "./helpers/db";

/**
 * The security review as a test (Phase Z).
 *
 * A review is a sentence somebody wrote once; this is the same review run on every
 * commit. Each case is one line of the brief's checklist, and each failure names
 * the thing that regressed rather than "something is wrong".
 *
 * The specific attacks are covered elsewhere and stay there: tests/security.test.ts
 * (a regular user cannot approve, elevate or moderate), tests/roles.test.ts (every
 * door for all four roles), tests/rate-limits.test.ts, tests/deal-image-url.test.ts
 * (M-1), tests/function-grants.test.ts. This file is the sweep: the properties that
 * must hold across the WHOLE schema, where a new table is the likely way to break
 * them.
 */

/** Tables that are deny-all on purpose: RLS on, no policy, no grant to a person. */
const DENY_ALL = [
  "admin_actions",        // the audit log: written by definer functions only (0032)
  "display_name_changes", // the rate-limit ledger for the public name (0033)
  "notification_deliveries",
  "notification_events",
  "submission_blocks",    // read by admin_submitters(), written by two functions (0035)
];

describe("the whole schema, swept", () => {
  it("has row level security on every table", async () => {
    const db = await freshDatabase();
    const { rows } = await db.query<{ t: string }>(
      `select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`,
    );
    expect(rows.map((r) => r.t)).toEqual([]);
  });

  it("leaves a table without a policy only where deny-all is the intent", async () => {
    const db = await freshDatabase();
    const { rows } = await db.query<{ t: string }>(
      `select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
          and not exists (select 1 from pg_policy p where p.polrelid = c.oid) order by 1`,
    );
    // A new name here is either a table somebody forgot to write policies for, or a
    // deliberate deny-all that belongs on the list above with its reason.
    expect(rows.map((r) => r.t)).toEqual(DENY_ALL);
  });

  it("gives the anonymous public no way to write anything", async () => {
    const db = await freshDatabase();
    const { rows } = await db.query<{ t: string; p: string }>(
      `select table_name as t, privilege_type as p from information_schema.role_table_grants
        where grantee = 'anon' and table_schema = 'public'
          and privilege_type in ('INSERT', 'UPDATE', 'DELETE') order by 1, 2`,
    );
    expect(rows).toEqual([]);
  });

  it("guards every SECURITY DEFINER function, or scopes it to the caller", async () => {
    const db = await freshDatabase();
    const { rows } = await db.query<{ name: string }>(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
          and pg_get_functiondef(p.oid) !~ 'require_(admin|super_admin|moderator|price_writer)'
          and pg_get_functiondef(p.oid) !~ 'auth\\.uid\\(\\)'
        order by 1`,
    );
    // A definer function runs as its owner. It must therefore either check who is
    // asking, or act only on rows belonging to auth.uid(). The one exception is
    // callable by nobody — asserted below rather than assumed.
    expect(rows.map((r) => r.name)).toEqual(["recount_contributor"]);

    for (const role of ["anon", "authenticated"]) {
      const can = await db.query<{ ok: boolean }>(
        "select has_function_privilege($1, 'public.recount_contributor(uuid)', 'execute') as ok",
        [role],
      );
      expect(can.rows[0].ok, role).toBe(false);
    }
  });

  it("keeps the uploads bucket small, typed, and writable only into your own folder", async () => {
    const db = await freshDatabase();
    const { rows } = await db.query<{ id: string; limit: number; mimes: string[] }>(
      "select id, file_size_limit as limit, allowed_mime_types as mimes from storage.buckets order by id",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("deal-images");
    // Five megabytes, and images only: a photo of a shelf label, not a file drop.
    expect(rows[0].limit).toBe(5_242_880);
    expect(rows[0].mimes).toEqual(["image/jpeg", "image/png", "image/webp", "image/heic"]);

    const { rows: policies } = await db.query<{ p: string; cmd: string }>(
      `select polname as p, polcmd::text as cmd from pg_policy p
         join pg_class c on c.oid = p.polrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'storage' order by 1`,
    );
    // Read public (the photo hangs off a public deal), insert into your own folder,
    // delete for an administrator. No UPDATE policy: a file is replaced, not edited.
    expect(policies.map((r) => `${r.p}:${r.cmd}`).sort()).toEqual([
      "admins manage deal images:d",
      "deal images are public:r",
      "users upload deal images into their own folder:a",
    ]);
  });

  it("lets nobody but an owner hand out privileges", async () => {
    const db = await freshDatabase();
    for (const fn of ["grant_admin(text,public.admin_level)", "revoke_admin(uuid)"]) {
      const def = await db.query<{ src: string }>(
        "select pg_get_functiondef(('public.' || $1)::regprocedure) as src",
        [fn],
      );
      expect(def.rows[0].src, fn).toContain("require_super_admin");
    }
  });

  it("has no table a person can write to without a policy deciding it", async () => {
    const db = await freshDatabase();
    const { rows } = await db.query<{ t: string; p: string }>(
      `select g.table_name as t, g.privilege_type as p
         from information_schema.role_table_grants g
         join pg_class c on c.relname = g.table_name
         join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        where g.grantee = 'authenticated' and g.table_schema = 'public'
          and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
          and not exists (
            select 1 from pg_policy p
             where p.polrelid = c.oid
               -- '*' is a FOR ALL policy, which covers every command. Matching only
               -- the per-command letters reported two dozen false findings on the
               -- first run — the kind of noise that teaches people to ignore a sweep.
               and p.polcmd::text in (
                 '*',
                 case g.privilege_type
                   when 'INSERT' then 'a' when 'UPDATE' then 'w' when 'DELETE' then 'd' end
               )
          )
        order by 1, 2`,
    );
    // A grant with no matching policy is a door with no lock behind it: RLS denies
    // by default, so this is currently a dead grant — and a dead grant is exactly
    // what becomes a live one the day somebody adds a permissive policy.
    expect(rows.map((r) => `${r.t}:${r.p}`)).toEqual([]);
  });
});
