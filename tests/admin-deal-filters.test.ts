import { describe, expect, it } from "vitest";
import { withParams } from "@/lib/urls";

/**
 * The moderation filters live in the URL (Phase U).
 *
 * That is the whole design decision worth pinning: a moderator can refresh, use the
 * back button, keep a tab open on "rejected, Rami Levy" and send somebody the link
 * to exactly what they are looking at. State held in a client component would lose
 * all four, and the link-building is where that quietly breaks.
 */

const DEFAULTS = { status: "pending", source: "all" };

describe("a filter is a link", () => {
  it("leaves the default out of the URL, so the plain page has a plain address", () => {
    expect(withParams("/admin/queue", {}, { status: "pending" }, DEFAULTS)).toBe("/admin/queue");
    expect(withParams("/admin/queue", {}, { source: "all" }, DEFAULTS)).toBe("/admin/queue");
  });

  it("keeps the other choices when one of them changes", () => {
    const current = { status: "rejected", store: "rami-levy", source: "users" };
    const next = withParams("/admin/queue", current, { status: "approved" }, DEFAULTS);
    expect(next).toContain("status=approved");
    expect(next).toContain("store=rami-levy");
    expect(next).toContain("source=users");
  });

  it("drops one filter without disturbing the rest", () => {
    const current = { status: "all", store: "rami-levy", beer: "goldstar", q: "מועדון" };
    const next = withParams("/admin/queue", current, { store: undefined }, DEFAULTS);
    expect(next).not.toContain("store=");
    expect(next).toContain("beer=goldstar");
    expect(next).toContain("status=all");
  });

  it("encodes Hebrew search text rather than putting it in raw", () => {
    const next = withParams("/admin/queue", { status: "all" }, { q: "מועדון" }, DEFAULTS);
    expect(next).toContain("q=%D7%9E");
    expect(new URL(next, "https://example.test").searchParams.get("q")).toBe("מועדון");
  });

  it("treats an emptied search box as no filter at all", () => {
    const next = withParams("/admin/queue", { status: "all", q: "מועדון" }, { q: "" }, DEFAULTS);
    expect(next).toBe("/admin/queue?status=all");
  });
});
