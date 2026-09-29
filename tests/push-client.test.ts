import { describe, expect, it, vi } from "vitest";
import {
  derivePushState,
  disablePush,
  enablePush,
  TimeoutError,
  urlBase64ToBuffer,
  withTimeout,
  type EnablePushDeps,
} from "@/lib/push/client";
import { buildDealPath } from "@/lib/push/message";

describe("notification switch state (B-04: the switch must show what is true)", () => {
  const base = { supported: true, permission: "granted" as NotificationPermission, hasSubscription: true, profileEnabled: true };

  it("is on only with permission AND a real subscription AND the user's preference", () => {
    expect(derivePushState(base)).toEqual({ kind: "on" });
  });

  it("is NOT on for someone who never subscribed, whatever the stored preference says", () => {
    expect(derivePushState({ ...base, hasSubscription: false })).toEqual({ kind: "off" });
    expect(derivePushState({ ...base, permission: "default", hasSubscription: false })).toEqual({ kind: "off" });
  });

  it("is off when the user has switched it off, even if a device subscription lingers", () => {
    expect(derivePushState({ ...base, profileEnabled: false })).toEqual({ kind: "off" });
  });

  it("names the two states the user cannot fix from the switch", () => {
    expect(derivePushState({ ...base, permission: "denied" })).toEqual({ kind: "blocked" });
    expect(derivePushState({ ...base, supported: false })).toEqual({ kind: "unsupported" });
  });
});

describe("enablePush (B-05: nothing the browser refuses may crash the page)", () => {
  const goodSubscription = () => ({
    endpoint: "https://push.example/abc",
    toJSON: () => ({ keys: { p256dh: "p256", auth: "auth" } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  });

  const deps = (overrides: Partial<EnablePushDeps> = {}): EnablePushDeps => ({
    vapidPublicKey: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
    userAgent: "test",
    requestPermission: vi.fn().mockResolvedValue("granted"),
    subscribe: vi.fn().mockResolvedValue(goodSubscription()),
    saveSubscription: vi.fn().mockResolvedValue({ ok: true }),
    setEnabled: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  });

  it("subscribes, stores the device, then records the preference — in that order", async () => {
    const order: string[] = [];
    const d = deps({
      subscribe: vi.fn().mockImplementation(async () => (order.push("subscribe"), goodSubscription())),
      saveSubscription: vi.fn().mockImplementation(async () => (order.push("save"), { ok: true })),
      setEnabled: vi.fn().mockImplementation(async () => (order.push("flag"), { ok: true })),
    });
    expect(await enablePush(d)).toEqual({ ok: true });
    expect(order).toEqual(["subscribe", "save", "flag"]);
    expect(d.saveSubscription).toHaveBeenCalledWith({ endpoint: "https://push.example/abc", p256dh: "p256", auth: "auth", userAgent: "test" });
  });

  it("turns a refused subscribe() into a message instead of an exception", async () => {
    const d = deps({ subscribe: vi.fn().mockRejectedValue(new DOMException("push service unavailable", "AbortError")) });
    const outcome = await enablePush(d);
    expect(outcome.ok).toBe(false);
    expect(outcome).toMatchObject({ message: expect.stringContaining("להירשם להתראות") });
    expect(d.saveSubscription).not.toHaveBeenCalled();
    expect(d.setEnabled).not.toHaveBeenCalled();
  });

  it("gives up on a subscribe() that never answers (headless / unreachable push service)", async () => {
    const d = deps({ subscribe: vi.fn().mockReturnValue(new Promise(() => undefined)), timeoutMs: 20 });
    const outcome = await enablePush(d);
    expect(outcome).toMatchObject({ ok: false, message: expect.stringContaining("יותר מדי זמן") });
  });

  it("explains a denied or dismissed permission prompt differently", async () => {
    const denied = await enablePush(deps({ requestPermission: vi.fn().mockResolvedValue("denied") }));
    const dismissed = await enablePush(deps({ requestPermission: vi.fn().mockResolvedValue("default") }));
    expect(denied).toMatchObject({ ok: false, message: expect.stringContaining("חסומות") });
    expect(dismissed).toMatchObject({ ok: false, message: expect.stringContaining("לא אישרתם") });
  });

  it("does not try to subscribe when the server has no push key", async () => {
    const d = deps({ vapidPublicKey: "" });
    expect(await enablePush(d)).toMatchObject({ ok: false, message: expect.stringContaining("לא מוגדרות") });
    expect(d.subscribe).not.toHaveBeenCalled();
  });

  it("does not leave an orphaned browser subscription when saving fails", async () => {
    const subscription = goodSubscription();
    const d = deps({
      subscribe: vi.fn().mockResolvedValue(subscription),
      saveSubscription: vi.fn().mockResolvedValue({ ok: false, error: "אין לכם הרשאה לפעולה הזו." }),
    });
    expect(await enablePush(d)).toEqual({ ok: false, message: "אין לכם הרשאה לפעולה הזו." });
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(d.setEnabled).not.toHaveBeenCalled();
  });

  it("rejects a subscription that came back without encryption keys", async () => {
    const broken = { endpoint: "https://push.example/x", toJSON: () => ({}), unsubscribe: vi.fn().mockResolvedValue(true) };
    const d = deps({ subscribe: vi.fn().mockResolvedValue(broken) });
    expect(await enablePush(d)).toMatchObject({ ok: false });
    expect(d.saveSubscription).not.toHaveBeenCalled();
    expect(broken.unsubscribe).toHaveBeenCalled();
  });
});

describe("disablePush", () => {
  it("switches the preference off FIRST, so a failed cleanup can never keep the pushes coming", async () => {
    const order: string[] = [];
    const outcome = await disablePush({
      setEnabled: vi.fn().mockImplementation(async () => (order.push("flag"), { ok: true })),
      getSubscription: vi.fn().mockImplementation(async () => {
        order.push("get");
        return { endpoint: "e", toJSON: () => ({}), unsubscribe: vi.fn().mockRejectedValue(new Error("boom")) };
      }),
      deleteSubscription: vi.fn().mockImplementation(async () => (order.push("delete"), { ok: true })),
    });
    expect(outcome).toEqual({ ok: true });
    expect(order).toEqual(["flag", "get", "delete"]);
  });

  it("reports failure (and touches nothing else) if the preference cannot be saved", async () => {
    const getSubscription = vi.fn();
    const outcome = await disablePush({
      setEnabled: vi.fn().mockResolvedValue({ ok: false, error: "nope" }),
      getSubscription,
      deleteSubscription: vi.fn(),
    });
    expect(outcome).toEqual({ ok: false, message: "nope" });
    expect(getSubscription).not.toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it("decodes a base64url VAPID key to its 65 raw bytes", () => {
    const key = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
    expect(urlBase64ToBuffer(key).byteLength).toBe(65);
  });

  it("withTimeout rejects with TimeoutError and passes results through", async () => {
    await expect(withTimeout(new Promise(() => undefined), 10)).rejects.toBeInstanceOf(TimeoutError);
    await expect(withTimeout(Promise.resolve(7), 50)).resolves.toBe(7);
  });
});

describe("notification deep link (B-03: it must open a page that exists)", () => {
  it("is addressed by the beer's SLUG — the only thing /beer/[slug] resolves", () => {
    expect(buildDealPath({ beerSlug: "goldstar", category: "sixpack" })).toBe("/beer/goldstar?c=sixpack");
    expect(buildDealPath({ beerSlug: "tuborg-red", category: "case" })).toBe("/beer/tuborg-red?c=case");
  });

  it("never looks like a database id", () => {
    const path = buildDealPath({ beerSlug: "goldstar", category: "single" });
    expect(path).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
  });
});
