import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { FEEDS_TAG } from "@/lib/feeds";

export const dynamic = "force-dynamic";

/**
 * Tell the running app that the data underneath it has changed.
 *
 * The shared reads — the catalogue and the whole-feed aggregates — are held for
 * five minutes under FEEDS_TAG. Everything the APP can do to that data already
 * clears the tag (src/lib/actions/admin.ts). An INGESTION RUN cannot: it writes
 * to Postgres directly, from a script, with no idea that a Next server exists.
 * So after an import the app served the previous catalogue until the TTL expired
 * — and the SKU index is not merely stale in that window, it decides which
 * offers a beer page can find at all.
 *
 * Same doorbell discipline as the notification worker: Bearer CRON_SECRET,
 * constant-time comparison, and closed (503) rather than open when no secret is
 * configured. It reveals nothing and changes no data; the worst a caller with
 * the secret can do is make the next few requests slower.
 *
 * Called by scripts/ingest/run.mjs at the end of a run, and by the e2e suite
 * after it resets the fake database.
 */
function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 16) return false;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request: Request) {
  if ((process.env.CRON_SECRET ?? "").length < 16) {
    return NextResponse.json({ error: "revalidate endpoint is not configured" }, { status: 503 });
  }
  if (!authorised(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  revalidateTag(FEEDS_TAG);
  return NextResponse.json({ ok: true, tag: FEEDS_TAG });
}

export const POST = handle;
