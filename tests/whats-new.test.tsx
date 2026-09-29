// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MarkReleaseSeen } from "@/components/MarkReleaseSeen";
import { LAST_SEEN_KEY, WhatsNewLink } from "@/components/WhatsNewLink";
import WhatsNewPage from "@/app/whats-new/page";
import { latestRelease, latestVisibleVersion, visibleReleases } from "@/lib/releases";

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("What's New entry point", () => {
  it("is always present, and quiet: a link, not a popup", () => {
    render(<WhatsNewLink latestVersion={latestVisibleVersion} />);
    const link = screen.getByRole("link", { name: /מה חדש/ });
    expect(link.getAttribute("href")).toBe("/whats-new");
  });

  it("shows a dot for someone who has never opened it", async () => {
    render(<WhatsNewLink latestVersion={latestVisibleVersion} />);
    expect(await screen.findByTestId("whats-new-dot")).toBeTruthy();
  });

  it("drops the dot once the newest release has been read", async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, visibleReleases[0].version);
    render(<WhatsNewLink latestVersion={latestVisibleVersion} />);
    await waitFor(() => expect(screen.getByRole("link", { name: /מה חדש/ })).toBeTruthy());
    expect(screen.queryByTestId("whats-new-dot")).toBeNull();
  });

  it("shows the dot again when a newer release ships", async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, "0.0.1");
    render(<WhatsNewLink latestVersion={latestVisibleVersion} />);
    expect(await screen.findByTestId("whats-new-dot")).toBeTruthy();
  });

  it("opening the screen marks the newest release as seen", () => {
    render(<MarkReleaseSeen version={latestRelease.version} />);
    expect(window.localStorage.getItem(LAST_SEEN_KEY)).toBe(latestRelease.version);
  });
});

describe("What's New screen", () => {
  it("shows the latest release in full and earlier ones collapsed", () => {
    const { container } = render(<WhatsNewPage />);

    expect(screen.getByRole("heading", { name: latestRelease.title_he })).toBeTruthy();
    for (const line of latestRelease.highlights_he) expect(screen.getByText(line)).toBeTruthy();

    const earlier = container.querySelectorAll("details");
    expect(earlier.length).toBe(visibleReleases.length - 1);
    for (const detail of earlier) expect(detail.open).toBe(false);
  });
});
