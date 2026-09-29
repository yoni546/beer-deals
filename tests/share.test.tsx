// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PRODUCTION_URL, ShareApp } from "@/components/ShareApp";

/** "אהבתם? שתפו לחברים" always hands out the production address — never localhost, staging or a preview. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "share");
  Reflect.deleteProperty(navigator, "clipboard");
});

const define = (key: "share" | "clipboard", value: unknown) => Object.defineProperty(navigator, key, { value, configurable: true });

describe("share the app", () => {
  it("is the production address", () => {
    expect(PRODUCTION_URL).toBe("https://beer-deals.vercel.app");
  });

  it("uses the phone's share sheet when there is one", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    define("share", share);
    render(<ShareApp />);
    fireEvent.click(screen.getByRole("button", { name: "אהבתם? שתפו לחברים" }));
    await vi.waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: "https://beer-deals.vercel.app" })));
    expect(screen.queryByText("הקישור הועתק")).toBeNull();
  });

  it("copies the link where there is no share sheet, and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    define("clipboard", { writeText });
    render(<ShareApp />);
    fireEvent.click(screen.getByRole("button", { name: "אהבתם? שתפו לחברים" }));
    expect(await screen.findByText("הקישור הועתק")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith("https://beer-deals.vercel.app");
  });

  it("shows the address to copy by hand when copying is refused", async () => {
    define("clipboard", { writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    render(<ShareApp />);
    fireEvent.click(screen.getByRole("button", { name: "אהבתם? שתפו לחברים" }));
    expect(await screen.findByText("https://beer-deals.vercel.app")).toBeTruthy();
  });

  it("does nothing more when the person closes the share sheet", async () => {
    define("share", vi.fn().mockRejectedValue(new DOMException("closed", "AbortError")));
    const writeText = vi.fn();
    define("clipboard", { writeText });
    render(<ShareApp />);
    fireEvent.click(screen.getByRole("button", { name: "אהבתם? שתפו לחברים" }));
    await new Promise((r) => setTimeout(r, 10));
    expect(writeText).not.toHaveBeenCalled();
  });
});
