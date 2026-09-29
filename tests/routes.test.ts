import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const APP = join(import.meta.dirname, "..", "src", "app");

/**
 * A structural test, because the bug it guards against is structural.
 *
 * The admin layout redirects anyone who is not an admin to /admin/login. If
 * that layout also wraps the login page, arriving there redirects to arriving
 * there, and the browser loops until it gives up — which is exactly what
 * shipped once. Types passed, the build passed, and every page rendered; the
 * defect was in which directory a file sat in.
 *
 * Route groups — the "(panel)" folder — are what keep them apart, and a folder
 * is easy to move back by accident.
 */

/** Every directory under src/app that holds a layout.tsx. */
function layoutDirs(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) layoutDirs(full, found);
    else if (entry === "layout.tsx") found.push(dir);
  }
  return found;
}

describe("the admin login page is reachable", () => {
  const loginDir = join(APP, "admin", "login");

  it("exists", () => {
    expect(existsSync(join(loginDir, "page.tsx"))).toBe(true);
  });

  it("is not wrapped by any layout that redirects to it", () => {
    const guards = layoutDirs(join(APP, "admin")).filter((dir) =>
      readFileSync(join(dir, "layout.tsx"), "utf8").includes("/admin/login"),
    );

    for (const guard of guards) {
      // A layout applies to every route beneath its own directory. If the login
      // page is beneath a layout that redirects to the login page, that is the
      // loop.
      expect(
        loginDir.startsWith(guard + "\\") || loginDir.startsWith(guard + "/"),
        `${guard} redirects to /admin/login and also wraps it — that is an infinite redirect`,
      ).toBe(false);
    }

    // And the guard has to exist at all, or this test passes by doing nothing.
    expect(guards.length).toBeGreaterThan(0);
  });
});
