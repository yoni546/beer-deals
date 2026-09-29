import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runNotifications } from "@/lib/push/run";

export const dynamic = "force-dynamic";

/**
 * The notification worker's doorbell. A scheduler (GitHub Actions, see
 * .github/workflows/notifications.yml, or any cron) calls it every few minutes with
 *
 *     Authorization: Bearer $CRON_SECRET
 *
 * Without CRON_SECRET configured the endpoint is closed (503), never open. The comparison is
 * constant-time. The response carries counts only — no names, endpoints or message text.
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
    return NextResponse.json({ error: "notifications endpoint is not configured" }, { status: 503 });
  }
  if (!authorised(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const result = await runNotifications();
  return NextResponse.json(result, { status: result.ok ? 200 : result.reason === "failed" ? 500 : 503 });
}

export const GET = handle;
export const POST = handle;
