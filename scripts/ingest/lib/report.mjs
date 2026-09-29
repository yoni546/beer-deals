/**
 * The human-readable ingestion report (docs/INGESTION-DRY-RUN.md for a dry run,
 * docs/INGESTION-STAGING-REPORT.md for a write to staging). One renderer, so both say the same things
 * in the same words.
 */
const shekel = (a) => `₪${(a / 100).toFixed(2)}`;
const esc = (s) => String(s ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
const sum = (xs, f) => xs.reduce((n, x) => n + f(x), 0);

/**
 * @param {ReturnType<import("./plan.mjs").buildPlan>} plan
 * @param {{mode: "dry-run" | "staging", day: string, fetchReport: {publishers: any[]}, written?: any, generatedAt?: string}} ctx
 */
export function renderReport(plan, ctx) {
  const lines = [];
  const out = (s = "") => lines.push(s);
  const u = plan.units;
  const live = plan.promotions.filter((p) => p.status === "live" && p.conditions.audience === "everyone");
  const liveGroups = plan.groups.filter((g) => g.status === "live" && g.audience === "everyone");
  const restricted = plan.promoLog.filter((l) => l.audience !== "everyone" && l.kind !== "excluded");
  const blocked = ctx.fetchReport.publishers.filter((p) => p.status !== "OK");

  if (ctx.mode === "dry-run") {
    out("# Ingestion dry run");
    out();
    out(`**${ctx.generatedAt ?? new Date().toISOString().slice(0, 10)}, from the feed files fetched on ${ctx.day}.** DRY RUN: nothing was written to any database.`);
    out("Produced by `node scripts/ingest/dry-run.mjs` from files parsed by the installed skill's `parse_price_xml.py` (v1.6.0), plus");
    out("`lib/promo-supplement.mjs` for the one field it drops. One branch per retailer; the raw files stay in the git-ignored `.ingest-cache/`.");
  } else {
    out("# First real ingestion — STAGING");
    out();
    out(`**${ctx.generatedAt ?? new Date().toISOString()}.** Written to the **staging** project only (\`${ctx.written?.projectRef ?? "?"}\`), by`);
    out("`node scripts/ingest/run.mjs --target staging`, from the feed files fetched on " + ctx.day + ". Production was not touched.");
  }
  out();
  out("## Summary");
  out();
  out("| | |");
  out("| --- | ---: |");
  out(`| Publishers fetched · blocked | ${ctx.fetchReport.publishers.filter((p) => p.status === "OK").length} · ${blocked.length} |`);
  out(`| Retailers (chains) covered | ${new Set(u.map((x) => x.retailer)).size} |`);
  out(`| Branches covered | ${u.length} |`);
  out(`| Raw shelf rows | ${sum(u, (x) => x.rows).toLocaleString("en")} |`);
  out(`| Beer candidates (beer, non-alcoholic, radler) | ${sum(u, (x) => x.beer)} |`);
  out(`| … of our beers | ${sum(u, (x) => x.ours)} |`);
  out(`| … beers the app does not carry | ${sum(u, (x) => x.otherBeer)} |`);
  out(`| Out of scope (malt drinks, cider) | ${sum(u, (x) => x.outOfScope)} |`);
  out(`| Canonical SKUs | ${plan.skus.length} |`);
  out(`| Resolved products (feed items matched to a SKU) | ${plan.sourceProducts.filter((p) => p.status === "matched").length} |`);
  out(`| Unresolved products (review queue) | ${plan.sourceProducts.filter((p) => p.status === "review").length} |`);
  out(`| Regular-price observations | ${plan.regular.length} |`);
  out(`| Active universal promotions (single pack) | ${live.length} |`);
  out(`| Mix-and-match (group) promotions published | ${liveGroups.length} |`);
  out(`| Restricted promotions filtered (club, card, coupon, employees…) | ${restricted.length} |`);
  out(`| Promotions held for review (everyone could use them, but a statement was missing or disagreed) | ${plan.promoLog.filter((l) => /^held/.test(l.outcome ?? "") && l.audience === "everyone").length} |`);
  out(`| Invalid prices | ${plan.invalid.length} |`);
  out(`| Duplicate source rows | ${sum(u, (x) => x.duplicates)} |`);
  out(`| Barcodes seen at 2+ chains · read differently (held) | ${plan.multiChainBarcodes} · ${plan.barcodeConflicts.length} |`);
  if (ctx.written) {
    out(`| **Written: regular prices accepted · held by the database's gates · rejected** | ${ctx.written.regular.accepted} · ${ctx.written.regular.held} · ${ctx.written.regular.rejected} |`);
    out(`| **Written: promotions accepted · held · rejected** | ${ctx.written.promotions.accepted} · ${ctx.written.promotions.held} · ${ctx.written.promotions.rejected} |`);
    out(`| **Written: group promotions** | ${ctx.written.groups} |`);
    out(`| **Ingestion runs** | ${ctx.written.runs.map((r) => `\`${r.publisher}\` ${r.already ? "already imported" : r.run_id}`).join(", ")} |`);
  }
  out();
  out("## Chains and branches");
  out();
  out("| Retailer | Publisher (feed chain id) | Branch | Observed (file time, UTC) | Rows | Beer | Ours | Promotions touching beer | Published | Groups | Restricted | Held |");
  out("| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const x of u) {
    const p = x.promo;
    out(`| ${x.retailer} | ${x.publisher} (${x.branch.feed_chain_code}) | ${x.store} ${esc(x.name)} | ${String(x.observedAt).slice(0, 16).replace("T", " ")} | ${x.rows} | ${x.beer} | ${x.ours} | ${p.touching} | ${p.published} | ${p.groups} | ${p.restricted} | ${p.held + p.unreadable} |`);
  }
  for (const b of blocked) out(`| ${b.publisher} | — | — | **${b.status}**: ${esc(b.note)} | | | | | | | | |`);
  out();
  out("## Canonical SKUs");
  out();
  out("| Beer | Variant | Category | Container | ml | Pack | Retailers | Regular prices seen |");
  out("| --- | --- | --- | --- | ---: | ---: | --- | --- |");
  for (const s of [...plan.skus].sort((a, b) => b.retailers.length - a.retailers.length || a.key.localeCompare(b.key))) {
    out(`| ${s.beer} | ${s.variant || "—"} | ${s.category} | ${s.container} | ${s.volume_ml} | ${s.pack_quantity} | ${s.retailers.join(", ")} | ${shekel(Math.min(...s.prices))}–${shekel(Math.max(...s.prices))} |`);
  }
  out();
  out("## Promotions");
  out();
  out("| Retailer | Promotion | Read as | Basis | Audience | Outcome |");
  out("| --- | --- | --- | --- | --- | --- |");
  const order = (l) => (/published/.test(l.outcome ?? "") ? 0 : l.audience !== "everyone" ? 1 : 2);
  for (const l of [...plan.promoLog].sort((a, b) => order(a) - order(b))) {
    const as = l.kind === "multi_buy" ? `${l.qty} for ${shekel(l.total_agorot)}` : l.kind === "price_cut" ? shekel(l.price_agorot) : l.kind;
    out(`| ${l.retailer} | ${esc(l.description)} | ${as} | ${l.basis || "—"} | ${l.audience} | ${esc(l.outcome)} |`);
  }
  out();
  out("## Unresolved products (why each one was not priced)");
  out();
  const why = new Map();
  for (const r of plan.unresolved) {
    const k = r.why.replace(/\d{4,}/g, "…").replace(/\d+/g, "#");
    why.set(k, (why.get(k) ?? 0) + 1);
  }
  for (const [k, n] of [...why].sort((a, b) => b[1] - a[1]).slice(0, 25)) out(`* ${n} × ${esc(k).slice(0, 180)}`);
  out();
  out("Examples:");
  out();
  out("| Retailer | Code | Shelf name | Why |");
  out("| --- | --- | --- | --- |");
  for (const r of plan.unresolved.slice(0, 40)) out(`| ${r.retailer} | ${r.code} | ${esc(r.name)} | ${esc(r.why).slice(0, 160)} |`);
  out();
  out("## Invalid prices");
  out();
  if (plan.invalid.length === 0) out("None.");
  for (const r of plan.invalid) out(`* ${r.retailer} ${r.code} ${esc(r.name)} ₪${r.price}: ${esc(r.why)}`);
  out();
  out("## Out of scope (kept out on purpose)");
  out();
  const oos = new Map();
  for (const r of plan.outOfScope) oos.set(r.category, (oos.get(r.category) ?? 0) + 1);
  for (const [k, n] of oos) out(`* ${k}: ${n} rows`);
  out();
  return lines.join("\n") + "\n";
}
