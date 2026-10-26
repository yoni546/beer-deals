#!/usr/bin/env node
/**
 * Deletes the history nothing reads (migration 0066, prune_history): rejected price rows, promotion occurrences
 * from files that are no longer current, branch scans older than a week, replaced group promotions.
 * Live, held and superseded prices (the Deal Score's 180-day history) and notification events are never touched.
 *
 *   node scripts/ingest/prune-history.mjs --target staging                                       # count only
 *   node scripts/ingest/prune-history.mjs --target staging --apply
 *   node scripts/ingest/prune-history.mjs --target production --confirm-ref <ref> [--apply]
 *
 * In batches (each call deletes at most --batch rows of each kind, default 5000), until nothing is left.
 * Deleting frees space for reuse inside the database; the size Supabase reports drops only after
 * `vacuum full` (docs/PRUNE-HISTORY.md). Credentials and target checks: lib/target.mjs.
 * If the database does not have 0066 yet, it says so and exits 0 (the daily workflows run this after the
 * import; a project not yet migrated must not fail its import).
 */
import { createClient } from "@supabase/supabase-js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTarget } from "./lib/target.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? "" : (args[i + 1] ?? "");
};
const { url, env } = loadTarget(ROOT, args);
const apply = args.includes("--apply");
const batch = Number(flag("batch") || 5000);
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const KINDS = ["rejected_prices", "stale_occurrences", "old_branch_scans", "old_groups"];

async function call(p_kind, p_apply) {
  const { data, error } = await db.rpc("prune_history", { p_kind, p_apply, p_batch: batch });
  if (error && /prune_history/.test(error.message) && /(not find|does not exist|schema cache)/i.test(error.message)) {
    console.log("::warning::prune_history is not installed on this database (migration 0066) — nothing pruned.");
    process.exit(0);
  }
  if (error) throw new Error(`prune_history(${p_kind}): ${error.message}`);
  return data;
}
// One kind at a time, one after the other: each call is one statement under the 8 s statement timeout.
async function counts() {
  const out = {};
  for (const k of KINDS) out[k] = await call(k, false);
  return out;
}
const line = (o) => KINDS.map((k) => `${k} ${o[k]}`).join(" · ");

const before = await counts();
console.log(`to prune: ${line(before)}`);
if (!apply) {
  console.log("Dry run. Add --apply to delete.");
  process.exit(0);
}

const total = Object.fromEntries(KINDS.map((k) => [k, 0]));
const t0 = Date.now();
for (const k of KINDS) {
  for (;;) {
    const n = await call(k, true);
    total[k] += n;
    if (n === 0) break;
  }
  console.log(`  ${k}: ${total[k]} deleted`);
}
const after = await counts();
console.log(`pruned in ${Math.round((Date.now() - t0) / 1000)}s: ${line(total)}`);
console.log(`left: ${line(after)}`);
