import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * public/sw.js is plain JavaScript that only runs inside a browser's service worker, so it is
 * loaded here into a fake worker scope. What is proven: a push turns into the notification the
 * server described (and does not crash on an empty or garbled one), and a tap goes where the
 * server said — by reusing the tab the person is looking at, else opening one.
 *
 * What this cannot prove — that a real push service delivers to a real phone — is
 * docs/NOTIFICATIONS.md §5.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "..", "public", "sw.js"), "utf8");
const ORIGIN = "https://beer.example";

function boot() {
  const listeners = new Map<string, (event: unknown) => void>();
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const windows: Array<Record<string, unknown>> = [];
  const openWindow = vi.fn(async () => undefined);
  const scope = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: (event: unknown) => void) => listeners.set(type, handler),
    registration: { showNotification: async (title: string, options: Record<string, unknown>) => void shown.push({ title, options }) },
    clients: { matchAll: async () => windows, openWindow, claim: async () => undefined },
    skipWaiting: async () => undefined,
  };
  new Function("self", "caches", "URL", SOURCE)(scope, { open: async () => ({ addAll: async () => undefined }), keys: async () => [], delete: async () => true, match: async () => undefined }, URL);

  const push = async (data: unknown) => {
    const waits: Promise<unknown>[] = [];
    listeners.get("push")!({ data: data === undefined ? null : { json: () => (typeof data === "string" ? JSON.parse(data) : data) }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  const tap = async (url: string | undefined) => {
    const waits: Promise<unknown>[] = [];
    const notification = { close: vi.fn(), data: url === undefined ? undefined : { url } };
    listeners.get("notificationclick")!({ notification, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    return notification;
  };
  /** Drive the fetch handler as a navigation, the way the browser does. */
  const navigate = (url: string) => {
    let responded: Promise<Response> | undefined;
    listeners.get("fetch")!({
      request: { method: "GET", url, mode: "navigate" },
      preloadResponse: Promise.resolve(undefined),
      respondWith: (p: Promise<Response>) => void (responded = p),
    });
    return responded!;
  };

  return { push, tap, shown, windows, openWindow, navigate };
}

describe("push", () => {
  it("shows the notification the server described, in Hebrew, replacing a repeat via the tag", async () => {
    const { push, shown } = boot();
    await push({ title: "מבצע חדש ברמי לוי", body: "גולדסטאר 6 × 330 מ״ל · ₪25.00", url: "/beer/goldstar", tag: "offer:sku-1:rami-levy" });
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe("מבצע חדש ברמי לוי");
    expect(shown[0].options).toMatchObject({
      body: "גולדסטאר 6 × 330 מ״ל · ₪25.00",
      dir: "rtl",
      lang: "he",
      tag: "offer:sku-1:rami-levy",
      data: { url: "/beer/goldstar" },
    });
  });

  it("still shows something sensible when the payload is empty or not JSON", async () => {
    const empty = boot();
    await empty.push(undefined);
    expect(empty.shown[0].title).toBe("מבצע חדש");
    expect(empty.shown[0].options.data).toEqual({ url: "/" });

    const garbled = boot();
    await garbled.push("{not json");
    expect(garbled.shown).toHaveLength(1);
  });

  it("uses no emoji in its fallback text", async () => {
    const { push, shown } = boot();
    await push({});
    expect(JSON.stringify(shown)).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("tapping a notification", () => {
  const tab = (over: Record<string, unknown>) => ({ url: `${ORIGIN}/`, focused: false, visibilityState: "hidden", navigate: vi.fn(async function (this: unknown) { return this; }), focus: vi.fn(async () => undefined), ...over });

  it("opens the beer page in a new window when the app is not open", async () => {
    const { tap, openWindow } = boot();
    const notification = await tap("/beer/goldstar");
    expect(notification.close).toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/beer/goldstar`);
  });

  it("reuses the tab the person is looking at instead of piling up new ones", async () => {
    const { tap, windows, openWindow } = boot();
    const background = tab({});
    const foreground = tab({ visibilityState: "visible", focused: true });
    windows.push(background, foreground);
    await tap("/beer/goldstar");
    expect(foreground.navigate).toHaveBeenCalledWith(`${ORIGIN}/beer/goldstar`);
    expect(foreground.focus).toHaveBeenCalled();
    expect(background.navigate).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("never touches a background tab, and ignores other sites' windows", async () => {
    const { tap, windows, openWindow } = boot();
    windows.push(tab({ url: "https://elsewhere.example/", visibilityState: "visible", focused: true }), tab({}));
    await tap("/settings");
    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/settings`);
  });

  it("falls back to a new window when the browser refuses to navigate the tab", async () => {
    const { tap, windows, openWindow } = boot();
    windows.push(tab({ visibilityState: "visible", focused: true, navigate: vi.fn(async () => { throw new Error("not controlled"); }) }));
    await tap("/beer/goldstar");
    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/beer/goldstar`);
  });

  it("goes home when the notification carries no link", async () => {
    const { tap, openWindow } = boot();
    await tap(undefined);
    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
  });

  it("never opens a page of another site, whatever the payload says", async () => {
    const { tap, windows, openWindow } = boot();
    await tap("https://evil.example/phish");
    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);

    const foreground = tab({ visibilityState: "visible", focused: true });
    windows.push(foreground);
    await tap("//evil.example/phish");
    expect(foreground.navigate).toHaveBeenCalledWith(`${ORIGIN}/`);
  });
});

describe("a navigation that stops answering", () => {
  /**
   * REPORTED 2026-11-22, by the owner, about the installed app: "more than a second,
   * sometimes half a minute". A fetch over a mobile network that has dropped does not fail
   * quickly -- it hangs until the OS gives up -- and this handler used to wait for exactly
   * as long as that took, showing nothing, because as far as the app was concerned the
   * navigation simply had not finished.
   */
  it("gives up after ten seconds and shows the offline page, instead of waiting for ever", async () => {
    vi.useFakeTimers();
    try {
      // A network that never answers and never fails: the case that hung.
      const hung = vi.fn(() => new Promise<Response>(() => {}));
      vi.stubGlobal("fetch", hung);
      const { navigate } = boot();

      const navigation = navigate(`${ORIGIN}/beer`);
      let settled = false;
      void navigation.then(() => { settled = true; });

      await vi.advanceTimersByTimeAsync(9_000);
      expect(settled, "still waiting at nine seconds").toBe(false);

      await vi.advanceTimersByTimeAsync(1_500);
      const response = await navigation;
      expect(response.status).toBe(503);
      expect(await response.text()).toContain("אין חיבור");

      // The hung request is dropped rather than left running behind a response nobody sees.
      expect(hung.mock.calls[0][1].signal.aborted).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("does not cut off a slow connection that is still answering", async () => {
    vi.useFakeTimers();
    try {
      // Eight seconds is slow and real; it must still get its page.
      vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => setTimeout(() => resolve(new Response("<html>the page</html>", { status: 200 })), 8_000)));
      const { navigate } = boot();
      const navigation = navigate(`${ORIGIN}/beer`);
      await vi.advanceTimersByTimeAsync(8_500);
      const response = await navigation;
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("the page");
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("still serves a normal navigation from the network, uncached", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>live</html>", { status: 200 }));
    try {
      const { navigate } = boot();
      const response = await navigate(`${ORIGIN}/`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("live");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
