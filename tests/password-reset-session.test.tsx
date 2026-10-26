// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The set-a-password form must only appear behind a real recovered session.
 *
 * The first version of this page decided from the URL: `#type=recovery` in the
 * address bar was enough to show the form. But a fragment is just text anyone
 * can type, so /admin/reset#type=recovery reached the form with no token behind
 * it, and submitting it called updateUser against whatever session existed.
 *
 * That was harmless as it stood — the session there is the visitor's own
 * anonymous one, which has no email, so nothing could ever sign in with the
 * password it set. It is the kind of check that stops being harmless the moment
 * it is reused somewhere a real session can be present, which is why it is
 * pinned here rather than left to a comment.
 */

const getSession = vi.fn();
const exchangeCodeForSession = vi.fn();
const resetPasswordForEmail = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    auth: {
      getSession: () => getSession(),
      exchangeCodeForSession: (code: string) => exchangeCodeForSession(code),
      resetPasswordForEmail: (email: string, options: unknown) => resetPasswordForEmail(email, options),
      updateUser: vi.fn(),
    },
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

// env.ts throws at import when the public variables are absent, which has
// nothing to do with what is under test. The component only reads siteUrl, to
// build the redirect it asks Supabase for.
vi.mock("@/lib/env", () => ({ publicEnv: { siteUrl: "https://test.example" } }));

import { AdminPasswordReset } from "@/components/admin/AdminPasswordReset";

/** The form that sets a new password, as distinct from the one that asks for an email. */
const setPasswordForm = () => screen.queryByLabelText("סיסמה חדשה");
const askForEmailForm = () => screen.queryByLabelText("אימייל");

function visit(url: string) {
  window.history.replaceState({}, "", url);
}

beforeEach(() => {
  getSession.mockReset();
  exchangeCodeForSession.mockReset();
  resetPasswordForEmail.mockReset();
  // The default: an ordinary visitor, signed in anonymously, with no email.
  getSession.mockResolvedValue({ data: { session: { user: { email: null } } } });
});

afterEach(cleanup);

describe("the password reset page", () => {
  it("asks for an email when there is no recovery link at all", async () => {
    visit("/admin/reset");
    render(<AdminPasswordReset />);
    await waitFor(() => expect(askForEmailForm()).not.toBeNull());
    expect(setPasswordForm()).toBeNull();
  });

  it("refuses a typed #type=recovery with no session behind it", async () => {
    // Anyone can put this in the address bar.
    visit("/admin/reset#type=recovery");
    render(<AdminPasswordReset />);

    await waitFor(() => expect(askForEmailForm()).not.toBeNull());
    expect(setPasswordForm()).toBeNull();
    expect(screen.getByText(/הקישור כבר לא תקף/)).toBeTruthy();
  });

  it("refuses a code that exchanges into a session with no email", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    visit("/admin/reset?code=abc123");
    render(<AdminPasswordReset />);

    await waitFor(() => expect(askForEmailForm()).not.toBeNull());
    expect(setPasswordForm()).toBeNull();
  });

  it("shows the form when the link really did recover an account", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    getSession.mockResolvedValue({ data: { session: { user: { email: "admin@example.com" } } } });
    visit("/admin/reset?code=abc123");
    render(<AdminPasswordReset />);

    await waitFor(() => expect(setPasswordForm()).not.toBeNull());
    expect(askForEmailForm()).toBeNull();
  });

  it("takes the token out of the address bar once it is used", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    getSession.mockResolvedValue({ data: { session: { user: { email: "admin@example.com" } } } });
    visit("/admin/reset?code=abc123");
    render(<AdminPasswordReset />);

    await waitFor(() => expect(setPasswordForm()).not.toBeNull());
    // Out of the URL, so it is not in a screenshot, a shared link or history.
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
  });
});
