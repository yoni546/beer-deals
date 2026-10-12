import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `aria-labelledby` and `aria-describedby` take a SPACE-SEPARATED LIST OF IDREFS.
 *
 * Settings built its section ids by interpolating the Hebrew heading — `s-${title}` —
 * so "הבירות שלי" became the id `s-הבירות שלי`. A space is not valid in an id, and
 * the attribute split it into two tokens pointing at nothing: every section on that
 * page was unnamed to a screen reader navigating by region. axe does not flag it,
 * because both the attribute and the heading look well-formed on their own.
 *
 * So: an id handed to one of these attributes may never be built out of free text.
 */

const files = globSync("src/**/*.{ts,tsx}");

/** `id={...}` / aria-labelledby={...} whose expression interpolates something. */
const INTERPOLATED = /(aria-labelledby|aria-describedby)=\{`[^`]*\$\{([^}]+)\}/g;

describe("ids handed to aria attributes", () => {
  it("are never interpolated from text that could contain a space", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(INTERPOLATED)) {
        const expression = match[2].trim();
        // An id derived from a value we know is a slug or a generated id is fine;
        // one derived from a title, a name or a label is not.
        if (/\b(title|name|label|heading|text)\b/i.test(expression)) {
          offenders.push(`${file}: ${match[0]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("still names every section on the settings page", () => {
    const source = readFileSync("src/app/settings/page.tsx", "utf8");
    const ids = [...source.matchAll(/<Section id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(4);
    for (const id of ids) {
      expect(id, `${id} is not a plain slug`).toMatch(/^[a-z][a-z0-9-]*$/);
    }
    expect(new Set(ids).size).toBe(ids.length);
    // And the heading really does carry the id the section points at.
    expect(source).toMatch(/aria-labelledby=\{id\}/);
    expect(source).toMatch(/<h2 id=\{id\}/);
  });
});
