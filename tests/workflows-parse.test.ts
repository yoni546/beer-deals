import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

/**
 * GitHub refuses a workflow it cannot parse — and then never runs it, by hand or on schedule. 2026-10-06: an
 * `env:` key left with nothing under it made ingest-production.yml unparseable ("Unexpected value ''") after
 * tests that only read it as text had passed. So every workflow is parsed here, and the shapes GitHub rejects
 * are checked: every job has steps, every step runs or uses something, and no `env` / `with` is empty.
 */
const dir = join(__dirname, "..", ".github", "workflows");
const files = readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

type Step = Record<string, unknown> & { run?: string; uses?: string; env?: unknown; with?: unknown };
type Workflow = { on?: unknown; jobs?: Record<string, { steps?: Step[]; env?: unknown; "runs-on"?: unknown }> };

describe("every GitHub workflow parses and has the shape GitHub accepts", () => {
  it("there are workflows to check", () => expect(files.length).toBeGreaterThan(3));

  for (const file of files) {
    it(file, () => {
      const wf = load(readFileSync(join(dir, file), "utf8")) as Workflow;
      expect(wf.on, `${file}: on`).toBeTruthy();
      expect(wf.jobs && Object.keys(wf.jobs).length, `${file}: jobs`).toBeGreaterThan(0);
      for (const [name, job] of Object.entries(wf.jobs ?? {})) {
        expect(job["runs-on"], `${file} ${name}: runs-on`).toBeTruthy();
        if ("env" in job) expect(job.env, `${file} ${name}: empty job env`).toBeTruthy();
        expect(job.steps?.length, `${file} ${name}: steps`).toBeGreaterThan(0);
        for (const [i, step] of (job.steps ?? []).entries()) {
          const where = `${file} ${name} step ${i + 1} (${String(step.name ?? step.uses ?? "")})`;
          expect(Boolean(step.run) !== Boolean(step.uses), `${where}: exactly one of run / uses`).toBe(true);
          for (const key of ["env", "with"] as const) {
            if (key in step) expect(step[key], `${where}: empty ${key}`).toBeTruthy();
          }
        }
      }
    });
  }
});
