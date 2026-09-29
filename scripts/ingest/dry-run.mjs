#!/usr/bin/env node
/**
 * INGESTION DRY RUN — reads one day of fetched feed files (parsed by the installed skill) and reports what
 * an import WOULD write. It never writes to any database: it imports no Supabase client, reads no keys,
 * opens no network connection (tests/ingest.test.ts checks the source for all three).
 *
 *   node scripts/ingest/fetch-sample.mjs     # 1. a small read-only sample → .ingest-cache/<day>/
 *   node scripts/ingest/parse.mjs            # 2. the skill's parser on every price and promotion file
 *   node scripts/ingest/dry-run.mjs          # 3. → docs/INGESTION-DRY-RUN.md + .ingest-cache/<day>/plan.json
 *
 * The plan itself (lib/plan.mjs) is the same one scripts/ingest/run.mjs writes to staging.
 */
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlan, loadDay } from "./lib/plan.mjs";
import { renderReport } from "./lib/report.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const i = process.argv.indexOf("--day");
const cache = join(ROOT, ".ingest-cache");
const DAY = i > -1 ? process.argv[i + 1] : existsSync(cache) ? readdirSync(cache).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop() : "";
if (!DAY) {
  console.error("No .ingest-cache/<day>/ found. Run scripts/ingest/fetch-sample.mjs and scripts/ingest/parse.mjs first.");
  process.exit(1);
}
const DIR = join(cache, DAY);
const { units, fetchReport } = loadDay(DIR);
const plan = buildPlan(units);
writeFileSync(join(ROOT, "docs", "INGESTION-DRY-RUN.md"), renderReport(plan, { mode: "dry-run", day: DAY, fetchReport }));
writeFileSync(join(DIR, "plan.json"), JSON.stringify(plan, null, 1));
console.log(`branches ${plan.units.length} · SKUs ${plan.skus.length} · regular ${plan.regular.length} · promotions ${plan.promotions.length} · groups ${plan.groups.length} · unresolved ${plan.unresolved.length}`);
console.log(`wrote docs/INGESTION-DRY-RUN.md and .ingest-cache/${DAY}/plan.json — nothing was written to any database`);
