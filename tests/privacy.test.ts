import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRIVACY_CONTACT } from "@/lib/privacy";

/**
 * The privacy policy (/privacy) is a list of claims about this code, linked from both app stores. These
 * are the claims a later change could make false without anybody noticing the page.
 */
const page = readFileSync("src/app/privacy/page.tsx", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string>; devDependencies?: Record<string, string> };

describe("the privacy policy says what the code does", () => {
  it("'no third-party analytics or tracking': none is installed", () => {
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const tracker of ["@vercel/analytics", "@vercel/speed-insights", "posthog-js", "@sentry/nextjs", "mixpanel-browser", "react-ga4", "@amplitude/analytics-browser"]) {
      expect(deps, tracker).not.toContain(tracker);
    }
  });

  it("'a point to about 10 metres': the picker stores four decimals", () => {
    expect(readFileSync("src/components/PlacePicker.tsx", "utf8")).toMatch(/toFixed\(4\)/);
    expect(page).toContain("כ־10 מטרים");
  });

  it("'saved deals stay on the device, as ids': the cookie holds keys only", () => {
    expect(readFileSync("src/lib/saved.ts", "utf8")).not.toMatch(/agorot/);
    expect(page).toContain("עוגייה במכשיר");
  });

  it("names the deletion the settings screen actually has", () => {
    expect(readFileSync("src/components/DeleteAccount.tsx", "utf8")).toContain("מחיקת החשבון שלי");
    expect(page).toContain("מחיקת החשבון שלי");
  });

  it("opens with no session: it reads nobody's data and the middleware leaves it alone", () => {
    expect(page).not.toMatch(/getViewer|supabaseServer|cookies\(/);
    expect(readFileSync("src/middleware.ts", "utf8")).toMatch(/\|privacy\|/);
  });

  it("gives a real contact address", () => {
    expect(PRIVACY_CONTACT).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/);
  });
});
