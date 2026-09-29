import { describe, expect, it } from "vitest";
import { asUser } from "./helpers/db";
import { inDays, world, type World } from "./helpers/catalog";

/**
 * The safety net under the first real import (migration 0013, audit §19 items 6, 10, 12):
 * a file is imported once, implausible prices are held instead of published, and a bad run can
 * be undone WITHOUT leaving shelves empty.
 *
 * Nothing here imports anything real: it drives the write path with invented rows, as the
 * service role, the way the future runner will.
 */

type Item = Record<string, unknown>;

async function runner(w: World) {
  const feed = await w.source("chain-feed", "chain_feed");
  const service = <T>(work: () => Promise<T>) => asUser(w.db, null, work, "service_role");
  const start = async (hash: string | null) =>
    (await service(() => w.db.query<{ r: { run_id: string; already_imported: boolean } }>("select public.start_ingestion_run($1, $2) as r", [feed, hash]))).rows[0].r;
  const record = async (items: Item[], runId: string | null) =>
    (
      await service(() =>
        w.db.query<{ r: { accepted: number; rejected: number; held: number; errors: unknown[]; held_items: Array<{ index: number; reason: string }> } }>(
          "select public.record_prices($1, $2::jsonb, $3) as r",
          [feed, JSON.stringify(items), runId],
        ),
      )
    ).rows[0].r;
  const rollback = async (runId: string, reason = "test") =>
    (await service(() => w.db.query<{ r: { rejected: number; restored: number } }>("select public.rollback_ingestion_run($1, $2) as r", [runId, reason]))).rows[0].r;
  const finish = (runId: string, status: string) => service(() => w.db.query("select public.finish_ingestion_run($1, $2, '{\"rows\": 1}'::jsonb)", [runId, status]));
  return { feed, start, record, rollback, finish, service };
}

const regular = (sku: string, store: string, price: number, observedAt = inDays(0)): Item => ({ sku_id: sku, store_id: store, kind: "regular", price_agorot: price, observed_at: observedAt });

describe("a file is imported once", () => {
  it("returns the same run for the same file, and a new one for a different file", async () => {
    const w = await world();
    const r = await runner(w);
    const first = await r.start("sha256:aaa");
    expect(first.already_imported).toBe(false);
    expect((await r.start("sha256:aaa")).run_id).toBe(first.run_id); // still running → same run, no second import
    await r.finish(first.run_id, "succeeded");

    const again = await r.start("sha256:aaa");
    expect(again).toMatchObject({ run_id: first.run_id, already_imported: true });
    expect((await r.start("sha256:bbb")).already_imported).toBe(false);
  });

  it("lets a failed file be tried again", async () => {
    const w = await world();
    const r = await runner(w);
    const first = await r.start("sha256:ccc");
    await r.finish(first.run_id, "failed");
    const retry = await r.start("sha256:ccc");
    expect(retry.already_imported).toBe(false);
    expect(retry.run_id).not.toBe(first.run_id);
  });

  it("does not let an ordinary user start or finish runs", async () => {
    const w = await world();
    const r = await runner(w);
    await expect(asUser(w.db, w.visitor, () => w.db.query("select public.start_ingestion_run($1, 'x')", [r.feed]))).rejects.toMatchObject({ code: "42501" });
  });
});

describe("sanity gates hold what looks wrong instead of publishing it", () => {
  async function shelf(w: World) {
    const sku = await w.sku(w.ids.goldstar, "can", 330, 6);
    for (const [store, price] of [[w.ids.rami, 3790], [w.ids.shufersal, 3990], [w.ids.victory, 3690]] as const) await w.record({ sku, store, kind: "regular", price });
    return sku;
  }

  it("holds a price ten times the median, or a tenth of it, but not a merely high one", async () => {
    const w = await world();
    const r = await runner(w);
    const sku = await shelf(w);
    const run = await r.start(null);
    const result = await r.record(
      [regular(sku, w.ids.yochananof, 379_000), regular(sku, w.ids.yochananof, 300), regular(sku, w.ids.yochananof, 4200)],
      run.run_id,
    );
    expect(result).toMatchObject({ accepted: 3, held: 2, rejected: 0 });
    expect(result.held_items).toEqual([{ index: 1, reason: "price_out_of_range" }, { index: 2, reason: "price_out_of_range" }]);

    // Held rows exist for admins and never on a shelf the public sees.
    const held = await w.db.query<{ n: number }>("select count(*)::int n from public.price_observations where run_id = $1 and status = 'held'", [run.run_id]);
    expect(held.rows[0].n).toBe(2);
    const shown = await w.asPublic(() => w.db.query<{ price_agorot: number }>("select price_agorot from public.regular_prices_current where store_id = $1", [w.ids.yochananof]));
    expect(shown.rows.map((row) => row.price_agorot)).toEqual([4200]); // only the plausible one
  });

  it("holds a jump of more than 40% within two days, and keeps the previous price on the shelf", async () => {
    const w = await world();
    const r = await runner(w);
    const sku = await shelf(w);
    const run = await r.start(null);
    const result = await r.record([regular(sku, w.ids.rami, 2000)], run.run_id); // 3790 → 2000 = −47 %
    expect(result).toMatchObject({ accepted: 1, held: 1 });
    expect(result.held_items[0]).toEqual({ index: 1, reason: "sudden_change" });

    const now = await w.asPublic(() => w.db.query<{ price_agorot: number }>("select price_agorot from public.regular_prices_current where store_id = $1", [w.ids.rami]));
    expect(now.rows[0].price_agorot).toBe(3790);

    // A believable change goes through.
    expect((await r.record([regular(sku, w.ids.rami, 3500)], run.run_id)).held).toBe(0);
  });

  it("gives no opinion on a shelf it knows too little about", async () => {
    const w = await world();
    const r = await runner(w);
    const sku = await w.sku(w.ids.maccabee, "can", 330, 6);
    await w.record({ sku, store: w.ids.rami, kind: "regular", price: 3790 });
    const result = await r.record([regular(sku, w.ids.shufersal, 379_000)], null);
    expect(result).toMatchObject({ accepted: 1, held: 0 }); // only one chain has a price: no median to compare with
  });

  it("still reports outright bad records as errors, not as held", async () => {
    const w = await world();
    const r = await runner(w);
    const sku = await shelf(w);
    const result = await r.record([{ sku_id: sku, store_id: w.ids.rami, kind: "promotion", price_agorot: 2500, observed_at: inDays(0) }], null);
    expect(result).toMatchObject({ accepted: 0, rejected: 1, held: 0 });
  });
});

describe("rollback by run", () => {
  it("puts back the price the bad run replaced — the shelf is never left empty", async () => {
    const w = await world();
    const r = await runner(w);
    const sku = await w.sku(w.ids.goldstar, "can", 330, 6);

    const good = await r.start("good");
    await r.record([regular(sku, w.ids.rami, 3790, inDays(-2))], good.run_id);
    await r.finish(good.run_id, "succeeded");

    const bad = await r.start("bad");
    await r.record([regular(sku, w.ids.rami, 3800, inDays(-1))], bad.run_id);
    await r.finish(bad.run_id, "succeeded");

    const shelf = () => w.asPublic(() => w.db.query<{ price_agorot: number; observed_at: string }>("select price_agorot, observed_at from public.regular_prices_current where store_id = $1", [w.ids.rami]));
    expect((await shelf()).rows[0].price_agorot).toBe(3800);

    const undone = await r.rollback(bad.run_id, "wrong currency column");
    expect(undone).toMatchObject({ rejected: 1, restored: 1 });

    const after = await shelf();
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].price_agorot).toBe(3790);
    // Freshness stays honest: the restored price keeps the time it was actually seen.
    expect(new Date(after.rows[0].observed_at).getTime()).toBeLessThan(Date.now() - 1.5 * 86_400_000);

    // Nothing was deleted; the story is all still there, with the link between restored and original.
    const all = await w.db.query<{ status: string; run_id: string | null; raw: { restored_from?: number } | null }>("select status, run_id, raw from public.price_observations where sku_id = $1 order by id", [sku]);
    expect(all.rows.map((row) => row.status)).toEqual(["superseded", "rejected", "live"]);
    expect(all.rows[2].raw).toMatchObject({ restored_from: expect.any(Number) });
    expect(all.rows[2].run_id).toBeNull();

    const run = await w.db.query<{ status: string; stats: { rollback: { reason: string } } }>("select status, stats from public.ingestion_runs where id = $1", [bad.run_id]);
    expect(run.rows[0]).toMatchObject({ status: "rolled_back", stats: { rollback: { reason: "wrong currency column" } } });
  });

  it("removes a price that had no predecessor, and is safe to run twice", async () => {
    const w = await world();
    const r = await runner(w);
    const sku = await w.sku(w.ids.goldstar, "can", 330, 6);
    const run = await r.start("only");
    await r.record([regular(sku, w.ids.rami, 3790)], run.run_id);

    expect(await r.rollback(run.run_id)).toMatchObject({ rejected: 1, restored: 0 });
    const shelf = await w.asPublic(() => w.db.query("select * from public.regular_prices_current"));
    expect(shelf.rows).toHaveLength(0);

    expect(await r.rollback(run.run_id)).toMatchObject({ rejected: 1, restored: 0 }); // the stored summary; nothing new happens
    expect((await w.db.query("select count(*)::int n from public.price_observations")).rows[0]).toEqual({ n: 1 });
  });

  it("walks back past several versions written by the same run", async () => {
    const w = await world();
    const r = await runner(w);
    const sku = await w.sku(w.ids.goldstar, "can", 330, 6);
    const good = await r.start("g");
    await r.record([regular(sku, w.ids.rami, 3790, inDays(-3))], good.run_id);
    const bad = await r.start("b");
    await r.record([regular(sku, w.ids.rami, 3800, inDays(-2)), regular(sku, w.ids.rami, 3810, inDays(-1))], bad.run_id);

    expect(await r.rollback(bad.run_id)).toMatchObject({ restored: 1 });
    const shelf = await w.asPublic(() => w.db.query<{ price_agorot: number }>("select price_agorot from public.regular_prices_current"));
    expect(shelf.rows.map((row) => row.price_agorot)).toEqual([3790]);
  });

  it("leaves other runs and other shelves alone", async () => {
    const w = await world();
    const r = await runner(w);
    const sku = await w.sku(w.ids.goldstar, "can", 330, 6);
    const one = await r.start("1");
    await r.record([regular(sku, w.ids.shufersal, 3990)], one.run_id);
    const two = await r.start("2");
    await r.record([regular(sku, w.ids.rami, 3790)], two.run_id);

    await r.rollback(two.run_id);
    const shelf = await w.asPublic(() => w.db.query<{ price_agorot: number }>("select price_agorot from public.regular_prices_current"));
    expect(shelf.rows.map((row) => row.price_agorot)).toEqual([3990]);
  });

  it("cancels a promotion notification that has not gone out, and does not re-announce a restored promotion", async () => {
    const w = await world();
    const r = await runner(w);
    const sku = await w.sku(w.ids.goldstar, "can", 330, 6);
    await w.record({ sku, store: w.ids.rami, kind: "regular", price: 3790 });

    const good = await r.start("g");
    const promo = (price: number): Item => ({ sku_id: sku, store_id: w.ids.rami, kind: "promotion", promo_type: "price_cut", price_agorot: price, observed_at: inDays(0), valid_to: inDays(5), natural_key: "promo-1" });
    await r.record([promo(2500)], good.run_id);
    await r.finish(good.run_id, "succeeded");
    await w.db.query("update public.notification_events set status = 'done', outcome = 'sent'"); // that one went out

    const bad = await r.start("b");
    await r.record([promo(2300)], bad.run_id);
    const pending = await w.db.query<{ n: number }>("select count(*)::int n from public.notification_events where status = 'pending'");
    expect(pending.rows[0].n).toBe(1); // the bad price queued an announcement

    await r.rollback(bad.run_id);
    const after = await w.db.query<{ status: string; outcome: string | null }>("select status, outcome from public.notification_events order by id");
    expect(after.rows).toEqual([{ status: "done", outcome: "sent" }, { status: "done", outcome: "rolled_back" }]); // and the restored ₪25 queued nothing new
  });

  it("is for super admins and the service role only", async () => {
    const w = await world();
    const r = await runner(w);
    const run = await r.start("x");
    await expect(asUser(w.db, w.visitor, () => w.db.query("select public.rollback_ingestion_run($1)", [run.run_id]))).rejects.toMatchObject({ code: "42501" });
    await expect(asUser(w.db, null, () => w.db.query("select public.rollback_ingestion_run($1)", [run.run_id]), "anon")).rejects.toThrow();
    await expect(asUser(w.db, w.admin, () => w.db.query("select public.rollback_ingestion_run($1)", [run.run_id]))).resolves.toBeDefined(); // the seeded admin here is a super admin
  });
});
