import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The reason line on the "we could not connect" screen is a diagnostic, and a
 * diagnostic that leaks is worse than no diagnostic. These are the two things
 * about it that must stay true.
 */
const SOURCE = readFileSync(join(process.cwd(), "src/app/welcome/page.tsx"), "utf8");

describe("the sign-in failure screen", () => {
  it("never shows the reason on production", () => {
    // The guard is the first thing the function does, before any network call.
    const fn = SOURCE.slice(SOURCE.indexOf("async function anonymousSignInReason"));
    const guard = fn.indexOf('describeEnvironment().name === "production"');
    const fetchCall = fn.indexOf("fetch(");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(fetchCall);
    expect(fn.slice(guard, guard + 120)).toContain("return null");
  });

  it("never puts the key in what it prints", () => {
    const fn = SOURCE.slice(SOURCE.indexOf("async function anonymousSignInReason"));
    // The key goes in a header. It must not reach either returned string.
    const returned = [...fn.matchAll(/return `([^`]*)`/g)].map((m) => m[1]);
    expect(returned.length).toBeGreaterThan(0);
    for (const line of returned) expect(line).not.toContain("supabaseAnonKey");
  });

  it("says the status as well as the body", () => {
    // "refused" and "unreachable" read the same in a message and need different fixes.
    expect(SOURCE).toContain("HTTP ${response.status}");
    expect(SOURCE).toContain("could not reach");
  });
});
