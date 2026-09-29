/**
 * Generates CHANGELOG.md from src/content/releases.json — the only place release
 * notes are written by hand.
 *
 *   npm run changelog          # rewrite CHANGELOG.md
 *   npm run changelog:check    # exit 1 if CHANGELOG.md is out of date
 *
 * Never edit CHANGELOG.md directly: the next run would erase the edit, and the
 * check (and tests/releases.test.ts) would fail until the JSON says the same.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const RELEASES_PATH = join(ROOT, "src", "content", "releases.json");
export const CHANGELOG_PATH = join(ROOT, "CHANGELOG.md");

const KIND_LABEL = { feature: "Feature", fix: "Fix", data: "Data", design: "Design" };

export function renderChangelog(releases) {
  const lines = [
    "# Changelog",
    "",
    "<!-- GENERATED from src/content/releases.json by `npm run changelog`. Do not edit by hand. -->",
    "",
    "Versioning: PATCH = fix / copy / data, MINOR = new user-visible capability,",
    "MAJOR = data-model or navigation rebuild. Every meaningful change ships an entry",
    "(see CLAUDE.md).",
    "",
  ];

  for (const release of releases) {
    const kinds = release.kind.map((k) => KIND_LABEL[k] ?? k).join(", ");
    lines.push(`## ${release.version} — ${release.date}${release.showInApp ? "" : " (internal)"}`);
    lines.push("", `**${release.title_he}** · ${kinds}`, "");
    for (const bullet of release.highlights_he) lines.push(`- ${bullet}`);
    if (release.internal?.length) {
      lines.push("", "Internal:", "");
      for (const note of release.internal) lines.push(`- ${note}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function loadReleases() {
  return JSON.parse(readFileSync(RELEASES_PATH, "utf8"));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const next = renderChangelog(loadReleases());
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(CHANGELOG_PATH, "utf8").replace(/\r\n/g, "\n");
    } catch {
      // missing file counts as out of date
    }
    if (current !== next) {
      console.error("CHANGELOG.md is out of date. Run: npm run changelog");
      process.exit(1);
    }
    console.log("CHANGELOG.md is up to date.");
  } else {
    writeFileSync(CHANGELOG_PATH, next);
    console.log(`wrote ${CHANGELOG_PATH}`);
  }
}
