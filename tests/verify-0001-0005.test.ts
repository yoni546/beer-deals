import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { freshDatabase } from "./helpers/db";

/**
 * scripts/production/verify-0001-0005.sql decides whether a hand-built production database may have 0001–0005
 * marked applied (`supabase migration repair`). It must prove each migration from the objects it creates, say
 * NOT PROVEN when one is missing, and notice objects of later migrations. Run against the real migrations.
 */
const SQL = readFileSync(join(__dirname, "..", "scripts/production/verify-0001-0005.sql"), "utf8");
type Row = { version: string; present: number; expected: number; detail: string; verdict: string };
const verify = async (db: Awaited<ReturnType<typeof freshDatabase>>) => {
  const results = await db.exec(SQL);
  const rows = results[results.length - 1].rows as Row[];
  return Object.fromEntries(rows.map((r) => [r.version, r]));
};

describe("verify-0001-0005.sql", () => {
  it("proves 0001–0005 on a database built exactly that far, and finds nothing later", async () => {
    const r = await verify(await freshDatabase({ through: "0005" }));
    for (const v of ["0001", "0002", "0003", "0004", "0005"]) {
      expect(r[v].verdict, `${v}: ${r[v].detail}`).toMatch(/^APPLIED/);
      expect(Number(r[v].present)).toBe(Number(r[v].expected));
    }
    expect(r.later.verdict).toBe("none (as expected)");
  });

  it("does not prove a migration whose objects are missing — and names what is missing", async () => {
    const r = await verify(await freshDatabase({ through: "0004" }));
    expect(r["0004"].verdict).toMatch(/^APPLIED/);
    expect(r["0005"].verdict).toMatch(/^NOT PROVEN/);
    expect(r["0005"].detail).toContain("deals_one_approved_per_shelf_idx");
  });

  it("notices when later migrations were also applied by hand", async () => {
    const r = await verify(await freshDatabase({ through: "0009" }));
    expect(r.later.verdict).toMatch(/^LATER OBJECTS EXIST/);
    expect(r.later.detail).toContain("0007");
    expect(r.later.detail).toContain("0009 offers_feed");
  });

  it("inspect.sql reports a database the CLI never pushed to (no history table) instead of failing", async () => {
    const db = await freshDatabase({ through: "0005" });
    await db.exec("alter table auth.users add column if not exists is_anonymous boolean default false"); // as on Supabase
    const results = await db.exec(readFileSync(join(__dirname, "..", "scripts/production/inspect.sql"), "utf8"));
    const row = results[results.length - 1].rows[0] as Record<string, unknown>;
    expect(row.latest_migration).toBe("no history table");
    expect(row.migrations_recorded).toBe("no history table");
    expect(row.promotions_live).toBeNull(); // a 0007 table: not there yet, reported as null
    expect(Number(row.beers)).toBe(22);
  });

  it("is read-only", () => {
    const body = SQL.replace(/--.*$/gm, "");
    expect(body).not.toMatch(/\b(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/i);
  });
});
