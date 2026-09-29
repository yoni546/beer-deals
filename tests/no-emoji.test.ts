import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The interface uses drawn icons and words, never emoji (DESIGN.md, CLAUDE.md): emoji render
 * differently on every phone, ignore the theme, and read badly to screen readers.
 * This scans everything the app ships — screens, components, styles, the PWA files and the
 * notification worker — so one cannot come back unnoticed.
 */
const ROOT = join(import.meta.dirname, "..");
const SCANNED = ["src", "public"];
const EXTENSIONS = /\.(tsx?|css|html|js|json|webmanifest|svg)$/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return EXTENSIONS.test(name) ? [path] : [];
  });
}

describe("no emoji in anything the app ships", () => {
  it("finds none", () => {
    const found: string[] = [];
    for (const dir of SCANNED) {
      for (const file of files(join(ROOT, dir))) {
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, index) => {
            if (/\p{Extended_Pictographic}/u.test(line)) found.push(`${relative(ROOT, file)}:${index + 1}  ${line.trim().slice(0, 80)}`);
          });
      }
    }
    expect(found).toEqual([]);
  });
});
