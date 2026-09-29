// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvironmentBadge } from "@/components/EnvironmentBadge";
import { describeEnvironment, PRODUCTION_SUPABASE_REF } from "@/lib/environment";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("describeEnvironment", () => {
  it("prefers the explicit APP_ENV, then Vercel's own label, else assumes development", () => {
    expect(describeEnvironment({ APP_ENV: "staging", VERCEL_ENV: "production" }).name).toBe("staging");
    expect(describeEnvironment({ VERCEL_ENV: "production" }).name).toBe("production");
    expect(describeEnvironment({ VERCEL_ENV: "preview" }).name).toBe("preview");
    expect(describeEnvironment({}).name).toBe("development");
    expect(describeEnvironment({ APP_ENV: "nonsense" }).name).toBe("development");
  });

  it("notices when an environment is wired to the production database", () => {
    const prod = `https://${PRODUCTION_SUPABASE_REF}.supabase.co`;
    expect(describeEnvironment({ APP_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: prod }).usesProductionDatabase).toBe(true);
    expect(describeEnvironment({ APP_ENV: "staging", NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" }).usesProductionDatabase).toBe(false);
    expect(describeEnvironment({ APP_ENV: "test", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }).usesProductionDatabase).toBe(false);
  });
});

describe("EnvironmentBadge", () => {
  it("shows nothing in production and in tests", () => {
    vi.stubEnv("APP_ENV", "production");
    const { container } = render(<EnvironmentBadge />);
    expect(container.innerHTML).toBe("");
    cleanup();
    vi.stubEnv("APP_ENV", "test");
    expect(render(<EnvironmentBadge />).container.innerHTML).toBe("");
  });

  it("labels staging and development", () => {
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://other.supabase.co");
    render(<EnvironmentBadge />);
    expect(screen.getByText("staging")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("raises a warning when a non-production environment is on the production database", () => {
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${PRODUCTION_SUPABASE_REF}.supabase.co`);
    render(<EnvironmentBadge />);
    expect(screen.getByRole("alert").textContent).toContain("בסיס הנתונים של האתר החי");
  });
});
