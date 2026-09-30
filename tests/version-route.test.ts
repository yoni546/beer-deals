import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/version/route";
import packageJson from "../package.json";

afterEach(() => vi.unstubAllEnvs());

describe("/api/version — what is deployed, for the deployment checks", () => {
  it("names the release, the built commit, the environment and the Supabase project — and nothing secret", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "e04d09cb1eb3a78a9ac5214d3023d515306aa0a1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-only-secret");
    const res = GET();
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({ version: packageJson.version, commit: "e04d09cb1eb3a78a9ac5214d3023d515306aa0a1", environment: "production", supabaseRef: "abcdefghijklmnopqrst" });
    expect(JSON.stringify(body)).not.toContain("server-only-secret");
  });

  it("is outside the middleware, so asking never creates an anonymous visitor", () => {
    const middleware = readFileSync(join(__dirname, "..", "src/middleware.ts"), "utf8");
    expect(middleware).toContain("|api/version).*)");
  });
});
