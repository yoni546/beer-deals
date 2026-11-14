import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A cookie addressed to a DIFFERENT Supabase project is not this project's unreadable
 * session, and must not be read as one.
 *
 * MEASURED, production, 2026-11-14, three days after the move to Frankfurt: every
 * returning visitor was stuck on "לא הצלחנו להתחבר", permanently, while a browser that
 * had never opened the app worked first time. Reproduced exactly by putting
 * `sb-itpyyexhmvosxcbcagvy-auth-token` (the Tokyo project's cookie) into a working
 * browser and reloading.
 *
 * The chain: `getSession()` finds nothing, because @supabase/ssr reads only
 * `sb-<this ref>-auth-token`; `hasAuthCookie()` matched on the `sb-`/`auth-token` shape
 * and said yes; so middleware took the "a cookie is present but unreadable" branch and
 * passed through WITHOUT minting an identity. That branch is right for a half-written
 * chunk, which becomes readable on the next request. A cookie belonging to another
 * project never does.
 *
 * This is asserted on the source rather than by booting Next's middleware, as
 * tests/ingest.test.ts does for run.mjs: the defect was one predicate, and a test that
 * names it fails for the right reason.
 */
const middleware = readFileSync(join(__dirname, "..", "src", "middleware.ts"), "utf8");

describe("middleware · a cookie from another project is not a session", () => {
  it("matches the auth cookie by this project's ref, not by the sb- prefix alone", () => {
    expect(middleware).toContain("const prefix = PROJECT_REF ? `sb-${PROJECT_REF}-` : \"sb-\"");
    expect(middleware).toMatch(/name\.startsWith\(prefix\)/);
    // The bug, in one line, which must not come back.
    expect(middleware).not.toMatch(/name\.startsWith\("sb-"\)\s*&&\s*name\.includes\("auth-token"\)/);
  });

  it("takes the ref from the configured project URL", () => {
    expect(middleware).toMatch(/const PROJECT_REF = .*publicEnv\.supabaseUrl/s);
  });

  it("falls back to the broad test rather than guessing, if the ref cannot be read", () => {
    // Minting an identity for someone who has one is how 0.11.0's predecessor destroyed
    // accounts. If the URL is ever unparseable, the safe direction is the old behaviour.
    expect(middleware).toContain('?.[1] ?? null');
    expect(middleware).toMatch(/PROJECT_REF \? `sb-\$\{PROJECT_REF\}-` : "sb-"/);
  });

  it("still refuses to mint over a cookie this project wrote", () => {
    // The guard itself is unchanged: present-and-unreadable still passes through.
    expect(middleware).toMatch(/if \(hasAuthCookie\(request\)\) \{[\s\S]*?session_cookie_unreadable[\s\S]*?return response;/);
  });
});
