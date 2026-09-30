#!/usr/bin/env node
/**
 * The notification BASELINE: after the first import into an environment, every promotion it found is queued
 * as "new" (the notification_events outbox, migration 0012/0014). None of it is news to anyone — it is what the
 * shelves hold today. This marks every queued event as handled (status done, outcome "baseline") so the worker
 * never sends it. Future imports only queue what is genuinely new (dedupe_key: pack · chain · promotion ·
 * price · start day), and a baselined event keeps its dedupe_key, so the same promotion is never re-queued.
 *
 *   node scripts/ingest/baseline-notifications.mjs --target production --confirm-ref <ref>            # count only
 *   node scripts/ingest/baseline-notifications.mjs --target production --confirm-ref <ref> --apply    # mark them
 *
 * Nothing is deleted. It touches only notification_events rows that are still pending; deliveries, people and
 * their subscriptions are untouched. Run it BEFORE the notification worker is given its CRON_SECRET.
 */
import { createClient } from "@supabase/supabase-js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTarget } from "./lib/target.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const { url, env } = loadTarget(ROOT, args);
const apply = args.includes("--apply");
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const count = async (status) => {
  const { count: n, error } = await db.from("notification_events").select("id", { count: "exact", head: true }).eq("status", status);
  if (error) throw new Error(`count ${status}: ${error.message}`);
  return n ?? 0;
};

const pending = await count("pending");
const { count: sent, error: sentError } = await db.from("notification_deliveries").select("id", { count: "exact", head: true }).eq("status", "sent");
if (sentError) throw new Error(`deliveries: ${sentError.message}`);
console.log(`pending notification events: ${pending} · deliveries ever sent: ${sent ?? 0}`);

if (!apply) {
  console.log(pending ? `Dry run: ${pending} would be marked done (outcome "baseline"). Add --apply to do it.` : "Nothing pending: the baseline is in place.");
  process.exit(0);
}

let marked = 0;
for (;;) {
  const { data, error } = await db.from("notification_events").select("id").eq("status", "pending").order("id").limit(1000);
  if (error) throw new Error(`read pending: ${error.message}`);
  if (!data.length) break;
  const { error: updateError, count: n } = await db
    .from("notification_events")
    .update({ status: "done", outcome: "baseline", processed_at: new Date().toISOString() }, { count: "exact" })
    .in("id", data.map((r) => r.id))
    .eq("status", "pending"); // an event the worker took meanwhile is left as the worker left it
  if (updateError) throw new Error(`mark baseline: ${updateError.message}`);
  if (!n) throw new Error("the database marked none of the pending events (permissions?) — stopping");
  marked += n;
}
const left = await count("pending");
console.log(`marked ${marked} as baseline · still pending: ${left}`);
if (left) process.exit(1);
