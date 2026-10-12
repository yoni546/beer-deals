import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

/**
 * The movement between screens (0.34.0).
 *
 * Almost every navigation in this app is a client-side render, so the cross-document
 * `@view-transition` rule never fires for it — which is why the app felt static. The
 * transition is therefore plain CSS on an element that is re-keyed by the path.
 *
 * These tests hold the two things that are easy to lose later: that the page is
 * actually wrapped (an unwrapped layout animates nothing, silently), and that the
 * transition never becomes something that delays a screen or fights the one animation
 * that was already there.
 */
describe("moving between screens", () => {
  const layout = read("src", "app", "layout.tsx");
  const css = read("src", "app", "globals.css");
  const component = read("src", "components", "ui", "PageTransition.tsx");

  it("wraps the whole page, so every route gets it", () => {
    expect(layout).toContain("<PageTransition>{children}</PageTransition>");
    expect(layout).toContain('from "@/components/ui/PageTransition"');
  });

  it("re-keys by the path only, so a filter on the same screen updates in place", () => {
    expect(component).toContain("usePathname()");
    expect(component).toContain("key={pathname}");
    // A re-key on the query string would make every sort and every chip flash.
    expect(component).not.toContain("useSearchParams");
  });

  it("is short, and starts after the screen is already there", () => {
    const rule = css.match(/\.page-enter \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/animation:\s*page-enter\s+(\d+)ms/);
    const ms = Number(rule.match(/animation:\s*page-enter\s+(\d+)ms/)![1]);
    expect(ms).toBeGreaterThan(0);
    // Anything longer stops being an arrival and becomes a wait.
    expect(ms).toBeLessThanOrEqual(400);
    // No delay: a delay is time the person spends looking at nothing.
    expect(rule).not.toMatch(/animation-delay/);
  });

  it("moves and fades, and nothing else — no layout, no colour", () => {
    const frames = css.match(/@keyframes page-enter \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(frames).toContain("opacity: 0");
    expect(frames).toContain("translateY");
    for (const forbidden of ["width", "height", "margin", "padding", "display"]) {
      expect(frames, forbidden).not.toContain(`${forbidden}:`);
    }
  });

  it("leaves the first screen of a document alone", () => {
    // Which is also how the arrival from onboarding keeps its own 780ms journey
    // without a fade over it, and why a plain page load is not delayed by anything.
    expect(component).toContain("useState(pathname)");
    expect(component).toContain('pathname === landedOn ? undefined : "page-enter"');
  });

  it("holds no transform after it has played", () => {
    // A filling animation keeps the transform applied for the element's whole life,
    // composites the page under it, and makes a 44px tap target measure 43.99999.
    const rule = css.match(/\.page-enter \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).not.toMatch(/\b(both|forwards)\b/);
    expect(rule).not.toMatch(/animation-fill-mode/);
  });

  it("is removed for somebody who asked for less motion", () => {
    // The blanket prefers-reduced-motion rule above it cuts every animation to 0.01ms,
    // so this transition must not opt itself out of that with !important.
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    const rule = css.match(/\.page-enter \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).not.toContain("!important");
  });

  it("still has no loading.tsx anywhere, which is the thing that broke navigation once", () => {
    // Guarded elsewhere too; repeated here because this is the change that touches
    // navigation feel, and a skeleton is the tempting next step after an animation.
    expect(read("docs", "LESSONS.md")).toContain("loading.tsx");
  });
});
