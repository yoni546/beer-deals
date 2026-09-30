import { describe, expect, it } from "vitest";
import { checkTarget, parseEnvFile, refOf, STAGING_REF } from "../scripts/ingest/lib/target.mjs";

/**
 * Where an ingestion script may write (docs/PRODUCTION-HANDOFF-YONI.md). Production only with its own file,
 * APP_ENV=production, a project ref typed by the operator that matches the file, and never staging's ref.
 */
const PROD = "abcdefghijklmnopqrst"; // any 20-character ref that is not staging's
const env = (ref: string, appEnv: string, key = "service-key") => ({ NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`, APP_ENV: appEnv, SUPABASE_SERVICE_ROLE_KEY: key });

describe("ingestion target", () => {
  it("accepts staging only as staging", () => {
    expect(checkTarget({ target: "staging", env: env(STAGING_REF, "staging") })).toEqual({ target: "staging", ref: STAGING_REF });
    expect(() => checkTarget({ target: "staging", env: env(STAGING_REF, "production") })).toThrow(/APP_ENV must be "staging"/);
    expect(() => checkTarget({ target: "staging", env: env("itpyyexhmvosxcbcagvy", "staging") })).toThrow(/PRODUCTION project/);
  });

  it("accepts production only with APP_ENV=production and the operator's matching --confirm-ref", () => {
    expect(checkTarget({ target: "production", env: env(PROD, "production"), confirmRef: PROD })).toEqual({ target: "production", ref: PROD });
    expect(() => checkTarget({ target: "production", env: env(PROD, "production") })).toThrow(/--confirm-ref/);
    expect(() => checkTarget({ target: "production", env: env(PROD, "production"), confirmRef: "zzzzzzzzzzzzzzzzzzzz" })).toThrow(/does not match/);
    expect(() => checkTarget({ target: "production", env: env(PROD, "staging"), confirmRef: PROD })).toThrow(/APP_ENV must be "production"/);
  });

  it("never lets production point at the staging project, even when confirmed", () => {
    expect(() => checkTarget({ target: "production", env: env(STAGING_REF, "production"), confirmRef: STAGING_REF })).toThrow(/STAGING project/);
  });

  it("refuses a missing key, a non-Supabase URL and an unknown target", () => {
    expect(() => checkTarget({ target: "production", env: env(PROD, "production", ""), confirmRef: PROD })).toThrow(/SERVICE_ROLE_KEY/);
    expect(() => checkTarget({ target: "production", env: { ...env(PROD, "production"), NEXT_PUBLIC_SUPABASE_URL: "https://example.com" }, confirmRef: PROD })).toThrow(/supabase\.co/);
    expect(() => checkTarget({ target: "prod", env: env(PROD, "production") })).toThrow(/--target/);
    expect(() => checkTarget({ target: "", env: {} })).toThrow(/--target/);
  });

  it("reads env files the way people write them", () => {
    expect(parseEnvFile('APP_ENV=production\r\n# note\nNEXT_PUBLIC_SUPABASE_URL="https://abcdefghijklmnopqrst.supabase.co"\n')).toEqual({
      APP_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    });
    expect(refOf("https://abcdefghijklmnopqrst.supabase.co/")).toBe("abcdefghijklmnopqrst");
    expect(refOf("https://abcdefghijklmnopqrst.supabase.co.evil.com")).toBeNull();
  });
});
