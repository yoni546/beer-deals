// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Beer } from "@/lib/db/types";

const completeOnboarding = vi.fn();
const hardNavigate = vi.fn();

vi.mock("@/lib/actions/profile", () => ({
  completeOnboarding: (...args: unknown[]) => completeOnboarding(...args),
}));
vi.mock("@/lib/navigation", () => ({ hardNavigate: (path: string) => hardNavigate(path) }));

import { Onboarding } from "@/components/Onboarding";

const beer = (slug: string, name: string): Beer => ({
  id: `${slug}-id`, slug, name_he: name, name_en: slug,
  theme_base: "#111111", theme_surface: "#222222", theme_accent: "#ddaa22", theme_ink: "#ffffff",
  sort_order: 1, is_active: true,
});
const BEERS = [beer("a", "אלפא"), beer("b", "בטא"), beer("c", "גמא"), beer("d", "דלתא"), beer("e", "אפסילון")];

beforeEach(() => {
  completeOnboarding.mockReset();
  hardNavigate.mockReset();
  // InstallPrompt asks the browser whether the app is installed.
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as never;
});
afterEach(cleanup);

/** Name, four beers, their order — and on to the place step, where the save button lives. */
async function rankFourBeers(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText("יוני"), "דנה");
  await user.click(screen.getByRole("button", { name: "ממשיכים" }));
  for (const name of ["אלפא", "בטא", "גמא", "דלתא"]) {
    await user.click(screen.getByRole("button", { name, pressed: false }));
  }
  await user.click(screen.getByRole("button", { name: "לדירוג" }));
  await user.click(screen.getByRole("button", { name: "ממשיכים" })); // the place step (0026)
}

describe("onboarding (B-06 / B-07)", () => {
  it("shows the last step only after the save succeeded, and keeps it there", async () => {
    completeOnboarding.mockResolvedValue({ ok: true, message: "נשמר." });
    const user = userEvent.setup();
    render(<Onboarding beers={BEERS} />);

    await rankFourBeers(user);
    expect(screen.queryByRole("button", { name: /קדימה/ })).toBeNull(); // not before the save

    await user.click(screen.getByRole("button", { name: "סיימנו" }));
    const finish = await screen.findByRole("button", { name: /קדימה/ });
    expect(completeOnboarding).toHaveBeenCalledTimes(1);

    // The bug: it disappeared about a second later. Give any such timer time to fire.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(screen.getByRole("button", { name: /קדימה/ })).toBe(finish);

    await user.click(finish);
    expect(hardNavigate).toHaveBeenCalledWith("/");
  });

  it("sends the name and the beers in the order they were ranked", async () => {
    completeOnboarding.mockResolvedValue({ ok: true, message: "נשמר." });
    const user = userEvent.setup();
    render(<Onboarding beers={BEERS} />);
    await rankFourBeers(user);
    await user.click(screen.getByRole("button", { name: "סיימנו" }));
    await screen.findByRole("button", { name: /קדימה/ });

    const formData = completeOnboarding.mock.calls[0][1] as FormData;
    expect(formData.get("firstName")).toBe("דנה");
    expect(formData.get("beerIds")).toBe("a-id,b-id,c-id,d-id");
  });

  it("stays on the ranking step, with the error next to the button, when the save fails", async () => {
    completeOnboarding.mockResolvedValue({ ok: false, error: "אין לכם הרשאה לפעולה הזו." });
    const user = userEvent.setup();
    render(<Onboarding beers={BEERS} />);

    await rankFourBeers(user);
    await user.click(screen.getByRole("button", { name: "סיימנו" }));

    expect(await screen.findByText("אין לכם הרשאה לפעולה הזו.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /קדימה/ })).toBeNull();
    // still able to try again
    expect((screen.getByRole("button", { name: "סיימנו" }) as HTMLButtonElement).disabled).toBe(false);
    await waitFor(() => expect(hardNavigate).not.toHaveBeenCalled());
  });

  // 0024: one beer is enough. Four is the ceiling, not the entry fee.
  it("will not move on with nothing picked, and moves on as soon as one is", async () => {
    const user = userEvent.setup();
    render(<Onboarding beers={BEERS} />);
    await user.type(screen.getByPlaceholderText("יוני"), "דנה");
    await user.click(screen.getByRole("button", { name: "ממשיכים" }));

    expect((screen.getByRole("button", { name: "בחרו בירה אחת לפחות" }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: "אלפא" }));
    expect((screen.getByRole("button", { name: "לדירוג" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("takes no more than four", async () => {
    const user = userEvent.setup();
    render(<Onboarding beers={BEERS} />);
    await user.type(screen.getByPlaceholderText("יוני"), "דנה");
    await user.click(screen.getByRole("button", { name: "ממשיכים" }));

    for (const beer of BEERS) await user.click(screen.getByRole("button", { name: beer.name_he }));

    // Whatever the catalogue holds, only four can ever be pressed.
    const chosen = screen.getAllByRole("button", { pressed: true });
    expect(chosen.length).toBeLessThanOrEqual(4);
  });
});
