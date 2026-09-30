import { describe, expect, it } from "vitest";
import { asUser } from "./helpers/db";
import { inDays, world, type World } from "./helpers/catalog";

/**
 * Migration 0017: where a promotion is. "בכל הרשת" only with the publisher's word or every known branch
 * checked and matching in the same scan; otherwise participating / single / unknown — never a guess.
 */

async function chain(w: World, n: number) {
  const ids: string[] = [];
  for (let i = 1; i <= n; i++) {
    ids.push((await w.one<{ id: string }>("insert into public.branches (store_id, external_ref, name_he, city, listed_in_stores_file) values ($1, $2, $3, 'עיר', true) returning id", [w.ids.rami, `b${i}`, `סניף ${i}`])).id);
  }
  return ids;
}

/** One scan: each branch's outcome and the promotions file it names ("promo-<branch>" unless given). */
const scan = (w: World, id: string, rows: Array<{ branch: string; status: string; file?: string }>) =>
  asUser(w.db, w.admin, () =>
    w.db.query("select public.record_branch_scan($1, $2, now(), $3::jsonb)", [
      id,
      w.ids.rami,
      JSON.stringify(rows.map((r) => ({ branch_id: r.branch, status: r.status, promo_file: r.file ?? `promo-${r.branch}` }))),
    ]),
  );

/** Where the source LISTS a promotion (its branch's promotions file), shown or not. */
const listed = (w: World, key: string, branches: string[], published = true, file = (b: string) => `promo-${b}`) =>
  asUser(w.db, w.admin, () =>
    w.db.query("select public.record_promotion_occurrences($1, $2::jsonb)", [
      w.ids.rami,
      JSON.stringify(branches.map((b) => ({ branch_id: b, canonical_key: key, source_promotion_id: "P1", source_file: file(b), observed_at: new Date().toISOString(), kind: "price", price_agorot: 2490, published }))),
    ]),
  );
const refresh = (w: World) => asUser(w.db, w.admin, () => w.db.query("select public.refresh_promotion_scope($1)", [w.ids.rami]));

async function promo(w: World, sku: string, branches: string[], key = "rami-levy:c:goldstar6-2490", price = 2490) {
  for (const branch of branches) {
    await w.record({ sku, store: w.ids.rami, branch, kind: "promotion", promoType: "price_cut", price, naturalKey: key, validTo: inDays(5) });
  }
  await listed(w, key, branches);
}

const feed = async (w: World) =>
  (await w.asPublic(async () => (await w.db.query<Record<string, unknown>>("select * from public.offers_feed where origin = 'catalog' order by effective_agorot")).rows));

describe("promotion_scope — the one rule", () => {
  const rule = async (w: World, declared: string | null, known: number, checked: number, matching: number) =>
    w.one<{ scope: string; scope_evidence: string }>("select * from public.promotion_scope($1, $2, $3, $4)", [declared, known, checked, matching]);

  it("decides every case the product names", async () => {
    const w = await world();
    expect(await rule(w, null, 1, 1, 1)).toEqual({ scope: "chainwide", scope_evidence: "observed_all_known_eligible_branches" }); // the chain has one branch, checked
    expect(await rule(w, null, 18, 1, 1)).toEqual({ scope: "unknown", scope_evidence: "insufficient_coverage" }); // one sampled branch
    expect(await rule(w, "chainwide", 18, 1, 1)).toEqual({ scope: "chainwide", scope_evidence: "source_declared" });
    expect(await rule(w, null, 18, 18, 18)).toEqual({ scope: "chainwide", scope_evidence: "observed_all_known_eligible_branches" });
    expect(await rule(w, null, 18, 12, 12)).toEqual({ scope: "unknown", scope_evidence: "insufficient_coverage" }); // all checked, not all known
    expect(await rule(w, null, 18, 18, 12)).toEqual({ scope: "participating_branches", scope_evidence: "observed_subset" });
    expect(await rule(w, null, 18, 18, 1)).toEqual({ scope: "single_branch", scope_evidence: "observed_subset" });
    // "Only here" needs every known branch checked: with 2 of 71 checked it is only "participating".
    expect(await rule(w, null, 71, 2, 1)).toEqual({ scope: "participating_branches", scope_evidence: "observed_subset" });
    expect(await rule(w, null, 18, 17, 17)).toEqual({ scope: "unknown", scope_evidence: "insufficient_coverage" }); // one branch failed
  });
});

describe("scope from real observations", () => {
  it("one branch checked out of several known is NOT chainwide, even though it has the promotion", async () => {
    const w = await world();
    const b = await chain(w, 4);
    const s = await w.sku(w.ids.goldstar, "bottle", 330, 6);
    await promo(w, s, [b[0]]);
    await scan(w, "scan-1", [{ branch: b[0], status: "ok" }, ...b.slice(1).map((branch) => ({ branch, status: "not_published" }))]);
    await refresh(w);
    const [row] = await feed(w);
    expect(row).toMatchObject({ scope: "unknown", branches_known: 4, branches_checked: 1, branches_matching: 1 });
  });

  it("the same promotion at every known branch, all checked in one scan, is chainwide — and ONE offer", async () => {
    const w = await world();
    const b = await chain(w, 3);
    const s = await w.sku(w.ids.goldstar, "bottle", 330, 6);
    await promo(w, s, b);
    await scan(w, "scan-1", b.map((branch) => ({ branch, status: "ok" })));
    await refresh(w);
    const rows = await feed(w);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ scope: "chainwide", scope_evidence: "observed_all_known_eligible_branches", branches_matching: 3, branch_count: 3 });
  });

  it("a branch that failed (or whose file is stale) blocks 'chainwide' — it was not checked, not found empty", async () => {
    const w = await world();
    const b = await chain(w, 3);
    const s = await w.sku(w.ids.goldstar, "bottle", 330, 6);
    await promo(w, s, b.slice(0, 2));
    await scan(w, "scan-1", [{ branch: b[0], status: "ok" }, { branch: b[1], status: "ok" }, { branch: b[2], status: "failed" }]);
    await refresh(w);
    expect((await feed(w))[0]).toMatchObject({ scope: "unknown", branches_checked: 2, branches_matching: 2 });

    await scan(w, "scan-2", [{ branch: b[0], status: "ok" }, { branch: b[1], status: "ok" }, { branch: b[2], status: "stale" }]);
    await refresh(w);
    expect((await feed(w))[0]).toMatchObject({ scope: "unknown", branches_checked: 2 });
  });

  it("seen at some of the checked branches → participating; at exactly one of several → single branch, named", async () => {
    const w = await world();
    const b = await chain(w, 4);
    const s = await w.sku(w.ids.goldstar, "bottle", 330, 6);
    const t = await w.sku(w.ids.maccabee, "bottle", 330, 6);
    await promo(w, s, b.slice(0, 2), "rami-levy:c:goldstar6");
    await promo(w, t, [b[3]], "rami-levy:c:maccabee6");
    await scan(w, "scan-1", b.map((branch) => ({ branch, status: "ok" })));
    await refresh(w);
    const rows = await feed(w);
    const gold = rows.find((r) => r.beer_slug === "goldstar");
    const mac = rows.find((r) => r.beer_slug === "maccabee");
    expect(gold).toMatchObject({ scope: "participating_branches", branches_matching: 2, branches_checked: 4 });
    expect(mac).toMatchObject({ scope: "single_branch", branches_matching: 1, only_branch_name: "סניף 4" });
  });

  it("where a branch LISTS the promotion but our own price check held its copy, it still counts as there", async () => {
    const w = await world();
    const b = await chain(w, 3);
    const s = await w.sku(w.ids.goldstar, "bottle", 330, 6);
    await promo(w, s, b.slice(0, 2));
    await listed(w, "rami-levy:c:goldstar6-2490", [b[2]], false);
    await scan(w, "scan-1", b.map((branch) => ({ branch, status: "ok" })));
    await refresh(w);
    expect((await feed(w))[0]).toMatchObject({ scope: "chainwide", branches_matching: 3 });
  });

  it("a listing from an older file of the branch is not current evidence", async () => {
    const w = await world();
    const b = await chain(w, 2);
    const s = await w.sku(w.ids.goldstar, "bottle", 330, 6);
    await promo(w, s, b); // listed in "promo-<branch>"
    await scan(w, "scan-2", [{ branch: b[0], status: "ok" }, { branch: b[1], status: "ok", file: "promo-newer" }]);
    await refresh(w);
    expect((await feed(w))[0]).toMatchObject({ scope: "single_branch", branches_matching: 1, branches_checked: 2 });
  });

  it("a newer promotions file closes what it no longer lists — an old observation is not current evidence", async () => {
    const w = await world();
    const b = await chain(w, 2);
    const s = await w.sku(w.ids.goldstar, "bottle", 330, 6);
    await w.record({ sku: s, store: w.ids.rami, branch: b[0], kind: "promotion", promoType: "price_cut", price: 2490, naturalKey: "k-old", validTo: inDays(5), observedAt: inDays(-1) });
    await asUser(w.db, w.admin, () => w.db.query("select public.close_missing_promotions($1, now())", [b[0]]));
    expect(await feed(w)).toHaveLength(0);
  });

  it("two different promotions with the same price are two offers (the key is the whole promotion, not the price)", async () => {
    const w = await world();
    const b = await chain(w, 2);
    const s = await w.sku(w.ids.goldstar, "bottle", 330, 6);
    await promo(w, s, [b[0]], "rami-levy:c:a", 2490);
    await promo(w, s, [b[1]], "rami-levy:c:b", 2490);
    await scan(w, "scan-1", b.map((branch) => ({ branch, status: "ok" })));
    await refresh(w);
    const rows = await feed(w);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.scope === "single_branch")).toBe(true);
  });

  it("eligibility and scope are independent: a club offer at every branch stays hidden", async () => {
    const w = await world();
    const b = await chain(w, 2);
    const s = await w.sku(w.ids.goldstar, "bottle", 330, 6);
    for (const branch of b) {
      await w.record({ sku: s, store: w.ids.rami, branch, kind: "promotion", promoType: "price_cut", price: 2000, naturalKey: "club", validTo: inDays(5), conditions: { audience: "club" } });
    }
    await scan(w, "scan-1", b.map((branch) => ({ branch, status: "ok" })));
    await refresh(w);
    expect(await feed(w)).toHaveLength(0);
    expect(await w.one<{ n: number }>("select count(*)::int as n from public.promotions")).toEqual({ n: 0 });
  });

  it("the where-sheet lists each branch once, with its name and city", async () => {
    const w = await world();
    const b = await chain(w, 3);
    const s = await w.sku(w.ids.goldstar, "bottle", 330, 6);
    await promo(w, s, b.slice(0, 2));
    await scan(w, "scan-1", b.map((branch) => ({ branch, status: "ok" })));
    await refresh(w);
    const rows = await w.asPublic(async () => (await w.db.query<{ branch_name: string; branch_city: string }>("select branch_name, branch_city from public.promotion_branches order by branch_name")).rows);
    expect(rows).toEqual([
      { branch_name: "סניף 1", branch_city: "עיר" },
      { branch_name: "סניף 2", branch_city: "עיר" },
    ]);
  });

  it("only the price writer can record scans or refresh scope", async () => {
    const w = await world();
    await expect(asUser(w.db, w.visitor, () => w.db.query("select public.refresh_promotion_scope($1)", [w.ids.rami]))).rejects.toThrow();
    await expect(asUser(w.db, null, () => w.db.query("select public.record_branch_scan('x', $1, now(), '[]')", [w.ids.rami]), "anon")).rejects.toThrow();
    await expect(asUser(w.db, w.visitor, () => w.db.query("select * from public.branch_scans"))).resolves.toMatchObject({ rows: [] });
  });
});
