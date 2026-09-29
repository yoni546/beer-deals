import { z } from "zod";
import raw from "@/content/releases.json";
import { isUnseen } from "@/lib/versions";

/**
 * The single source of truth for what changed and when.
 *
 * `src/content/releases.json` is the ONLY hand-edited release record. The
 * in-app "מה חדש" screen reads it, `CHANGELOG.md` is generated from it
 * (`npm run changelog`), and `tests/releases.test.ts` fails the build when
 * package.json, this file and CHANGELOG.md disagree. The permanent rule that
 * requires an entry for every meaningful change lives in CLAUDE.md.
 */

const semver = /^\d+\.\d+\.\d+$/;

export const releaseSchema = z.object({
  version: z.string().regex(semver, "version must look like 1.2.3"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  /** Short headline, shown in the app. */
  title_he: z.string().min(3),
  /** 1–5 plain-language bullets a customer can read; shown in the app. */
  highlights_he: z.array(z.string().min(3)).min(1).max(5),
  kind: z.array(z.enum(["feature", "fix", "data", "design"])).min(1),
  /** false = internal-only release: kept in CHANGELOG.md, hidden from the app. */
  showInApp: z.boolean(),
  /** Developer notes for CHANGELOG.md only. */
  internal: z.array(z.string()).optional(),
});

export type Release = z.infer<typeof releaseSchema>;

export const releasesSchema = z.array(releaseSchema).min(1);

/** Newest first, exactly as written in the JSON file. */
export const releases: Release[] = releasesSchema.parse(raw);

export const latestRelease: Release = releases[0];

/** What users see: internal-only releases are left out. */
export const visibleReleases: Release[] = releases.filter((release) => release.showInApp);

export { compareVersions } from "@/lib/versions";

/** The version the What's New link compares against (null when nothing is shown in the app). */
export const latestVisibleVersion: string | null = visibleReleases[0]?.version ?? null;

/** True when `seen` is missing or older than the newest visible release. */
export function hasUnseenRelease(seen: string | null | undefined): boolean {
  return isUnseen(seen, latestVisibleVersion);
}
