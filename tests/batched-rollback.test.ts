import { describe, expect, it } from "vitest";
import { asUser } from "./helpers/db";
import { inDays, world, type World } from "./helpers/catalog";

/**
 * Undoing a whole-chain import without one long transaction.
 *
 * `rollback_ingestion_run` walks every observation of a run in a single call.
 * At Shufersal's size that outlives the API gateway's timeout, and the operator
 * is left not knowing what committed — the worst state to be in while undoing a
 * bad import.
 *
 * The batched version does a bounded slice per call. What these tests actually
 * pin down is that stopping between slices is safe: the same rows are never
 * done twice, a run is not reported finished while work remains, and another
 * run's data is never touched.
 */

type Item = {
  sku_id: string;
  store_id: string;
  kind: string;
  price_agorot: number;
  observed_at: string;
};

type BatchResult = {
  batch_rejected: number;
  batch_restored: number;
  remaining: number;
  done: boolean;
  total: { rejected: number; restored: number; batches: number } | null;
};

async function runner(w: World) {
  const feed = await w.source("chain-feed", "chain_feed");
  const service = <T>(work: () => Promise<T>) => asUser(w.db, null, work, "service_role");
  const start = async (hash: string) =>
    (
      await service(() =>
        w.db.query<{ r: { run_id: string } }>("select public.start_ingestion_run($1, $2) as r", [feed, hash]),
      )
    ).rows[0].r;
  const record = async (items: Item[], runId: string | null) =>
    service(() =>
      w.db.query("select public.record_prices($1, $2::jsonb, $3) as r", [feed, JSON.stringify(items), runId]),
    );
  const finish = (runId: string, status: string) =>
    service(() =>
      w.db.query("select public.finish_ingestion_run($1, $2, '{\"rows\": 1}'::jsonb)", [runId, status]),
    );
  const batch = async (runId: string, limit: number, reason = "test") =>
    (
      await service(() =>
        w.db.query<{ r: BatchResult }>("select public.rollback_ingestion_run_batch($1, $2, $3) as r", [
          runId,
          limit,
          reason,
        ]),
      )
    ).rows[0].r;
  return { start, record, finish, batch, service };
}

const regular = (sku: string, store: string, price: number, observedAt = inDays(0)): Item => ({
  sku_id: sku,
  store_id: store,
  kind: "regular",
  price_agorot: price,
  observed_at: observedAt,
});

describe("batched rollback", () => {
  it("undoes a large run a slice at a time, and the slices add up", async () => {
    const w = await world();
    const r = await runner(w);

    const skus = [];
    for (let i = 0; i < 12; i++) skus.push(await w.sku(w.ids.goldstar, "can", 330 + i, 6));

    const run = await r.start("big");
    await r.record(skus.map((sku) => regular(sku, w.ids.rami, 3000)), run.run_id);
    await r.finish(run.run_id, "succeeded");

    const live = async () =>
      (
        await w.db.query<{ n: number }>(
          "select count(*)::int as n from public.price_observations where run_id = $1 and status = 'live'",
          [run.run_id],
        )
      ).rows[0].n;

    expect(await live()).toBe(12);

    // Five at a time: three slices for twelve rows.
    const first = await r.batch(run.run_id, 5);
    expect(first).toMatchObject({ batch_rejected: 5, remaining: 7, done: false });

    const second = await r.batch(run.run_id, 5);
    expect(second).toMatchObject({ batch_rejected: 5, remaining: 2, done: false });

    const third = await r.batch(run.run_id, 5);
    expect(third).toMatchObject({ batch_rejected: 2, remaining: 0, done: true });

    expect(await live()).toBe(0);
    expect(third.total).toMatchObject({ rejected: 12, batches: 3 });
  });

  it("does not call the run rolled back while rows remain", async () => {
    const w = await world();
    const r = await runner(w);

    const skus = [];
    for (let i = 0; i < 6; i++) skus.push(await w.sku(w.ids.goldstar, "can", 400 + i, 6));

    const run = await r.start("partial");
    await r.record(skus.map((sku) => regular(sku, w.ids.rami, 3000)), run.run_id);
    await r.finish(run.run_id, "succeeded");

    await r.batch(run.run_id, 2);

    // The status is the only thing a later operator will look at. If it said
    // "rolled_back" here, they would stop with four rows still live.
    const mid = await w.db.query<{ status: string }>("select status from public.ingestion_runs where id = $1", [
      run.run_id,
    ]);
    expect(mid.rows[0].status).not.toBe("rolled_back");

    await r.batch(run.run_id, 10);
    const end = await w.db.query<{ status: string }>("select status from public.ingestion_runs where id = $1", [
      run.run_id,
    ]);
    expect(end.rows[0].status).toBe("rolled_back");
  });

  it("is safe to call again after it has finished", async () => {
    const w = await world();
    const r = await runner(w);
    const sku = await w.sku(w.ids.goldstar, "can", 330, 6);

    const run = await r.start("once");
    await r.record([regular(sku, w.ids.rami, 3000)], run.run_id);
    await r.finish(run.run_id, "succeeded");

    expect(await r.batch(run.run_id, 100)).toMatchObject({ batch_rejected: 1, done: true });

    // A retry after a timeout must not reject anything a second time, and must
    // not inflate the totals.
    const again = await r.batch(run.run_id, 100);
    expect(again.done).toBe(true);
    expect(again.batch_rejected).toBe(0);
  });

  it("restores what the run replaced, the same as the unbatched version", async () => {
    const w = await world();
    const r = await runner(w);
    const sku = await w.sku(w.ids.goldstar, "can", 330, 6);

    const good = await r.start("good");
    await r.record([regular(sku, w.ids.rami, 3790, inDays(-2))], good.run_id);
    await r.finish(good.run_id, "succeeded");

    const bad = await r.start("bad");
    await r.record([regular(sku, w.ids.rami, 3800, inDays(-1))], bad.run_id);
    await r.finish(bad.run_id, "succeeded");

    const result = await r.batch(bad.run_id, 100, "wrong column");
    expect(result).toMatchObject({ batch_rejected: 1, batch_restored: 1, done: true });

    const shelf = await w.asPublic(() =>
      w.db.query<{ price_agorot: number }>(
        "select price_agorot from public.regular_prices_current where store_id = $1",
        [w.ids.rami],
      ),
    );
    expect(shelf.rows).toHaveLength(1);
    expect(shelf.rows[0].price_agorot).toBe(3790);
  });

  it("never touches another run", async () => {
    const w = await world();
    const r = await runner(w);
    const mine = await w.sku(w.ids.goldstar, "can", 330, 6);
    const theirs = await w.sku(w.ids.maccabee, "can", 330, 6);

    const runA = await r.start("A");
    await r.record([regular(mine, w.ids.rami, 3000)], runA.run_id);
    await r.finish(runA.run_id, "succeeded");

    const runB = await r.start("B");
    await r.record([regular(theirs, w.ids.rami, 3100)], runB.run_id);
    await r.finish(runB.run_id, "succeeded");

    await r.batch(runA.run_id, 100);

    const other = await w.db.query<{ status: string }>(
      "select status from public.price_observations where run_id = $1",
      [runB.run_id],
    );
    expect(other.rows.every((row) => row.status === "live")).toBe(true);

    const runBRow = await w.db.query<{ status: string }>("select status from public.ingestion_runs where id = $1", [
      runB.run_id,
    ]);
    expect(runBRow.rows[0].status).not.toBe("rolled_back");
  });

  it("refuses an unreasonable batch size", async () => {
    const w = await world();
    const r = await runner(w);
    const run = await r.start("limits");

    await expect(r.batch(run.run_id, 0)).rejects.toThrow(/p_limit/);
    await expect(r.batch(run.run_id, 10_000)).rejects.toThrow(/p_limit/);
  });

  it("refuses a caller who is neither a super admin nor the service role", async () => {
    const w = await world();
    const r = await runner(w);
    const run = await r.start("perms");

    await expect(
      w.db.query("select public.rollback_ingestion_run_batch($1, 10, 'nope')", [run.run_id]),
    ).rejects.toThrow(/privileges required|permission denied/i);
  });
});
