// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewVersion } from "@/components/NewVersion";

/**
 * The update prompt (Phase Y).
 *
 * A deploy replaces the server while a phone still has the previous build's
 * JavaScript on screen — an installed PWA can hold a tab for days — and the old
 * bundle then posts a Server Action the new server has never heard of. That is
 * where "Failed to find Server Action" came from. `/api/version` was built to
 * detect it and nothing ever called it.
 */

function visible(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

const answers = (version: string) =>
  vi.fn(async () => ({ ok: true, json: async () => ({ version }) }) as unknown as Response);

beforeEach(() => visible("visible"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("telling somebody a new version shipped", () => {
  it("says nothing while the deployed version is the one they are running", async () => {
    vi.stubGlobal("fetch", answers("1.2.3"));
    render(<NewVersion current="1.2.3" />);
    await act(async () => visible("visible"));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("offers a refresh when the deployed version differs", async () => {
    vi.stubGlobal("fetch", answers("1.3.0"));
    render(<NewVersion current="1.2.3" />);
    await act(async () => visible("visible"));
    expect(screen.getByText("יצאה גרסה חדשה של האפליקציה.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "רענון" })).toBeTruthy();
  });

  it("notices a rollback too, not only a newer version", async () => {
    // A build that is no longer deployed is just as stale as one that is too old.
    vi.stubGlobal("fetch", answers("1.1.0"));
    render(<NewVersion current="1.2.3" />);
    await act(async () => visible("visible"));
    expect(screen.queryByRole("status")).not.toBeNull();
  });

  it("never reloads by itself", async () => {
    const reload = vi.fn();
    vi.stubGlobal("fetch", answers("1.3.0"));
    Object.defineProperty(window, "location", { value: { reload }, configurable: true });

    render(<NewVersion current="1.2.3" />);
    await act(async () => visible("visible"));
    // Somebody halfway through typing a deal would lose it, and a page that
    // reloads under your hands is worse than a stale one. It offers; they choose.
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not ask while the tab is in the background", async () => {
    const fetcher = answers("1.3.0");
    vi.stubGlobal("fetch", fetcher);
    render(<NewVersion current="1.2.3" />);
    await act(async () => visible("hidden"));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("stays quiet when the check itself fails", async () => {
    // Offline, or the endpoint is down. Neither is news worth showing somebody.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    render(<NewVersion current="1.2.3" />);
    await act(async () => visible("visible"));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
