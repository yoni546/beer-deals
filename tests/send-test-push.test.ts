import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Send me a test notification" (Settings): the end-to-end smoke test of a phone. The action
 * talks to the database and the push service, both replaced here by recorders, so the
 * behaviour a person sees — what it says in each situation — is what is being tested.
 */

/** A query builder that is awaitable and returns the canned result whatever was chained. */
function chain(result: unknown, record?: (call: string, args: unknown[]) => void): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, name: string) {
        if (name === "then") return (resolve: (value: unknown) => void) => resolve(result);
        return (...args: unknown[]) => {
          record?.(name, args);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

const state = {
  user: { id: "user-1" } as { id: string } | null,
  subscriptions: [{ id: "s1", endpoint: "https://push.example/1", p256dh: "p", auth: "a" }] as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>,
  recentTests: 0,
  deleted: [] as unknown[],
  logged: [] as Array<Record<string, unknown>>,
  logAvailable: true,
};
const send = vi.fn();
let senderAvailable = true;

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => {
      if (table === "push_subscriptions") {
        return {
          select: () => chain({ data: state.subscriptions, error: null }),
          delete: () => ({ eq: async (_column: string, id: unknown) => state.deleted.push(id) }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseServiceRole: () =>
    state.logAvailable
      ? {
          from: () => ({
            select: () => chain({ count: state.recentTests }),
            insert: async (row: Record<string, unknown>) => state.logged.push(row),
          }),
        }
      : null,
}));
vi.mock("@/lib/push/sender", () => ({ createWebPushSender: () => (senderAvailable ? send : null) }));

import { sendTestPush } from "@/lib/actions/push";

beforeEach(() => {
  state.user = { id: "user-1" };
  state.subscriptions = [{ id: "s1", endpoint: "https://push.example/1", p256dh: "p", auth: "a" }];
  state.recentTests = 0;
  state.deleted = [];
  state.logged = [];
  state.logAvailable = true;
  senderAvailable = true;
  send.mockReset();
  send.mockResolvedValue(undefined);
});

describe("sendTestPush", () => {
  it("sends a real test message to the person's own devices and logs it", async () => {
    const result = await sendTestPush();
    expect(result).toEqual({ ok: true, message: "נשלחה התראת בדיקה. היא אמורה להגיע תוך שניות." });

    expect(send).toHaveBeenCalledTimes(1);
    const [target, payload, options] = send.mock.calls[0];
    expect(target).toEqual({ endpoint: "https://push.example/1", p256dh: "p", auth: "a" });
    expect(JSON.parse(payload)).toMatchObject({ title: "בדיקת התראה", url: "/settings", tag: "test" });
    expect(options).toEqual({ ttlSeconds: 300 });

    expect(state.logged).toEqual([expect.objectContaining({ user_id: "user-1", kind: "test", status: "sent", subscriptions_ok: 1, subscriptions_total: 1 })]);
  });

  it("says how many devices it reached", async () => {
    state.subscriptions.push({ id: "s2", endpoint: "https://push.example/2", p256dh: "p", auth: "a" });
    expect(await sendTestPush()).toEqual({ ok: true, message: "נשלחה התראת בדיקה ל־2 מכשירים." });
  });

  it("does not pretend when the server cannot send at all — and says it is not the phone's fault", async () => {
    senderAvailable = false;
    const result = await sendTestPush();
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.error).toContain("לא הוגדרה בשרת");
    expect(send).not.toHaveBeenCalled();
  });

  it("asks the person to turn notifications on when no device is registered", async () => {
    state.subscriptions = [];
    const result = await sendTestPush();
    expect(result.ok === false && result.error).toContain("הפעילו התראות");
  });

  it("needs a signed-in person", async () => {
    state.user = null;
    expect(await sendTestPush()).toMatchObject({ ok: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("limits how often it can be used", async () => {
    state.recentTests = 5;
    const result = await sendTestPush();
    expect(result.ok === false && result.error).toContain("נסו שוב בעוד שעה");
    expect(send).not.toHaveBeenCalled();
  });

  it("forgets a device the push service says is gone, and tells the person to switch notifications off and on", async () => {
    send.mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));
    const result = await sendTestPush();
    expect(result.ok === false && result.error).toContain("כבו והפעילו");
    expect(state.deleted).toEqual(["s1"]);
    expect(state.logged[0]).toMatchObject({ kind: "test", status: "failed", http_status: 410 });
  });

  it("reports a transient failure without blaming the person", async () => {
    send.mockRejectedValue(Object.assign(new Error("unavailable"), { statusCode: 503 }));
    const result = await sendTestPush();
    expect(result.ok === false && result.error).toContain("לא הצלחנו לשלוח");
    expect(state.deleted).toEqual([]);
  });

  it("still sends when the log cannot be written (no service role)", async () => {
    state.logAvailable = false;
    expect((await sendTestPush()).ok).toBe(true);
  });
});
