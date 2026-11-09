import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import app from "../android/app.json";
import { GET } from "@/app/.well-known/assetlinks.json/route";

/**
 * The Google Play app (docs/APP-STORES.md): its identity, and the Digital Asset Links file that lets it
 * open the site without a browser bar.
 */
describe("the Android app", () => {
  it("has a permanent package id and points at production", () => {
    expect(app.packageId).toBe("app.beerdeals");
    expect(app.host).toBe("beer-deals.vercel.app");
  });

  it("lists only well-formed SHA-256 fingerprints (public values, never a key)", () => {
    for (const fp of app.certSha256) expect(fp).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });

  it("publishes assetlinks.json for exactly that package and those keys", async () => {
    const body = await GET().json();
    if (app.certSha256.length === 0) {
      expect(body).toEqual([]);
      return;
    }
    expect(body).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: app.packageId, sha256_cert_fingerprints: app.certSha256 },
      },
    ]);
  });

  it("is built from secrets, and never commits a key", () => {
    const script = readFileSync("scripts/android/build-twa.mjs", "utf8");
    expect(script).toMatch(/process\.env\.ANDROID_KEYSTORE_PASSWORD/);
    expect(readFileSync(".gitignore", "utf8")).toMatch(/android\/build\//);
    const workflow = readFileSync(".github/workflows/android.yml", "utf8");
    expect(workflow).toMatch(/secrets\.ANDROID_KEYSTORE_BASE64/);
    expect(workflow).toMatch(/workflow_dispatch/);
  });
});
