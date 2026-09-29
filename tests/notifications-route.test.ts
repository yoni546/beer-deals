import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runNotifications = vi.fn();
vi.mock("@/lib/push/run", () => ({ runNotifications: () => runNotifications() }));

import { GET, POST } from "@/app/api/notifications/run/route";

/**
 * The worker's doorbell must be closed unless the caller proves it is the scheduler, and it
 * must never leak what it sent.
 */
const SECRET = "a-long-enough-secret-value-123";
const call = (handler: typeof POST, authorization?: string) =>
  handler(new Request("https://example.test/api/notifications/run", { method: "POST", headers: authorization ? { authorization } : {} }));

beforeEach(() => {
  runNotifications.mockReset();
  runNotifications.mockResolvedValue({ ok: true, summary: { events: 1, sent: 2, skipped: 0, deferred: 0, retried: 0, failed: 0, devicesRemoved: 0 } });
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("POST /api/notifications/run", () => {
  it("is closed (503) when no CRON_SECRET is configured — never open by default", async () => {
    const response = await call(POST, `Bearer ${SECRET}`);
    expect(response.status).toBe(503);
    expect(runNotifications).not.toHaveBeenCalled();
  });

  it("refuses a short secret as if it were unset", async () => {
    process.env.CRON_SECRET = "short";
    expect((await call(POST, "Bearer short")).status).toBe(503);
  });

  it("refuses a missing or wrong token (401) without running anything", async () => {
    process.env.CRON_SECRET = SECRET;
    expect((await call(POST)).status).toBe(401);
    expect((await call(POST, "Bearer nope")).status).toBe(401);
    expect((await call(POST, SECRET)).status).toBe(401); // the scheme matters
    expect((await call(POST, `Bearer ${SECRET}x`)).status).toBe(401);
    expect(runNotifications).not.toHaveBeenCalled();
  });

  it("runs the worker for the right token, over POST and GET, and returns counts only", async () => {
    process.env.CRON_SECRET = SECRET;
    for (const handler of [POST, GET]) {
      const response = await call(handler, `Bearer ${SECRET}`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ ok: true, summary: expect.objectContaining({ sent: 2 }) });
    }
    expect(runNotifications).toHaveBeenCalledTimes(2);
  });

  it("says 503 when the server is not set up to send, and 500 when the run failed", async () => {
    process.env.CRON_SECRET = SECRET;
    runNotifications.mockResolvedValueOnce({ ok: false, reason: "no VAPID keys configured" });
    expect((await call(POST, `Bearer ${SECRET}`)).status).toBe(503);
    runNotifications.mockResolvedValueOnce({ ok: false, reason: "failed", detail: "boom" });
    expect((await call(POST, `Bearer ${SECRET}`)).status).toBe(500);
  });
});
