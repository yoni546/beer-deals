import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import { CHANGELOG_PATH, renderChangelog } from "../scripts/changelog.mjs";
import {
  compareVersions,
  hasUnseenRelease,
  latestRelease,
  releases,
  releasesSchema,
  visibleReleases,
} from "@/lib/releases";
import raw from "@/content/releases.json";

/**
 * THE GUARD BEHIND THE PERMANENT RELEASE RULE (see CLAUDE.md).
 *
 * Every meaningful product change must bump the version, add an entry to
 * src/content/releases.json and regenerate CHANGELOG.md. An instruction file can
 * be forgotten; this test cannot — `npm run verify` and CI both run it, so a
 * change that skips the rule fails instead of merging.
 */
describe("release rule", () => {
  it("has a valid release record", () => {
    const parsed = releasesSchema.safeParse(raw);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues, null, 2)).toBe(true);
  });

  it("package.json version is the newest release (bump both together)", () => {
    expect(pkg.version, "package.json version must equal the first entry in src/content/releases.json").toBe(
      latestRelease.version,
    );
  });

  it("lists versions newest-first with no duplicates", () => {
    for (let i = 1; i < releases.length; i++) {
      expect(
        compareVersions(releases[i - 1].version, releases[i].version),
        `${releases[i - 1].version} must be newer than ${releases[i].version}`,
      ).toBeGreaterThan(0);
      expect(releases[i - 1].date >= releases[i].date, "dates must not go backwards").toBe(true);
    }
  });

  it("CHANGELOG.md is exactly what the release data generates (run `npm run changelog`)", () => {
    const committed = readFileSync(CHANGELOG_PATH, "utf8").replace(/\r\n/g, "\n");
    expect(committed).toBe(renderChangelog(releases));
  });

  it("shows at least one release in the app, written in Hebrew", () => {
    expect(visibleReleases.length).toBeGreaterThan(0);
    for (const release of visibleReleases) {
      expect(release.title_he).toMatch(/[֐-׿]/);
      for (const line of release.highlights_he) expect(line).toMatch(/[֐-׿]/);
    }
  });

  it("CLAUDE.md states the rule, so agents are told before they start", () => {
    const file = join(import.meta.dirname, "..", "CLAUDE.md");
    expect(existsSync(file), "CLAUDE.md must exist").toBe(true);
    const text = readFileSync(file, "utf8");
    expect(text).toContain("PERMANENT RULE");
    expect(text).toContain("src/content/releases.json");
    expect(text).toContain("npm run changelog");
  });
});

describe("version comparison", () => {
  it("compares numerically, not as text", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0", "0.2.0")).toBe(0);
    expect(compareVersions("0.1.9", "0.2.0")).toBeLessThan(0);
  });

  it("flags an update only when this browser has not seen the newest visible release", () => {
    expect(hasUnseenRelease(null)).toBe(true);
    expect(hasUnseenRelease("0.0.1")).toBe(true);
    expect(hasUnseenRelease(visibleReleases[0].version)).toBe(false);
  });
});
