import { describe, expect, it } from "vitest";
import { freshDatabase } from "./helpers/db";

/** 0023: the anonymous REST role cannot even call the signed-in and admin functions; signed-in callers still can. */
const USER_FUNCTIONS = [
  "admin_update_deal(uuid, uuid, uuid, public.deal_category, integer, integer, text)",
  "approve_deal(uuid)",
  "grant_admin(text, public.admin_level)",
  "resolve_report(uuid, public.report_status)",
  "revoke_admin(uuid)",
  "save_preferences(text, uuid[])",
  "save_push_subscription(text, text, text, text)",
  "set_deal_status(uuid, public.deal_status)",
  "set_weekly_deal(uuid)",
  "update_notification_settings(integer, integer, integer)",
];

describe("function grants (0023)", () => {
  it("anon cannot execute them; authenticated can (each still checks who is calling)", async () => {
    const db = await freshDatabase();
    for (const fn of USER_FUNCTIONS) {
      const row = (await db.query<{ anon: boolean; auth: boolean }>(
        `select has_function_privilege('anon', 'public.${fn}', 'execute') as anon, has_function_privilege('authenticated', 'public.${fn}', 'execute') as auth`,
      )).rows[0];
      expect(row, fn).toEqual({ anon: false, auth: true });
    }
  });

  it("no SECURITY DEFINER function a person could call is left executable by anon, except the two public checks", async () => {
    const db = await freshDatabase();
    const { rows } = await db.query<{ name: string }>(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
          and has_function_privilege('anon', p.oid, 'execute') order by 1`,
    );
    expect(rows.map((r) => r.name)).toEqual(["is_admin", "is_super_admin"]);
  });
});
