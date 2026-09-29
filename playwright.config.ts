import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests run the REAL app (production build) against a local fake
 * Supabase (tests/e2e/fake-supabase) — the repo's actual migrations on PGlite —
 * so nothing here can touch the production database.
 *
 *   npm run e2e                 # build + run at 390×844 and 430×932
 *   PW_CHANNEL=chrome npm run e2e   # use the locally installed Chrome
 *
 * Point the same specs at a deployed environment instead with E2E_BASE_URL
 * (then no local servers are started, and specs that need the fake are skipped).
 */
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3200);
const FAKE_PORT = Number(process.env.E2E_FAKE_PORT ?? 54321);
const REMOTE = process.env.E2E_BASE_URL;

const appEnv = {
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${FAKE_PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "fake-anon-key",
  NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${APP_PORT}`,
  // A syntactically valid, throw-away key so the client considers push configured.
  NEXT_PUBLIC_VAPID_PUBLIC_KEY:
    "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
  APP_ENV: "production", // behave like production: demo rows must never show
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_DIST_DIR: ".next-e2e",
};

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.ts/,
  // Against a deployed URL only the read-only smoke runs; everything else seeds
  // the local fake database. Locally, the deployed-smoke spec stays out of the way.
  testIgnore: REMOTE ? /(hotfix|whats-new)\.spec\.ts/ : /deployed-smoke\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // One shared fake database: specs reset it themselves, so no parallelism.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: REMOTE ?? `http://127.0.0.1:${APP_PORT}`,
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    channel: process.env.PW_CHANNEL || undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "mobile-390",
      use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    },
    {
      name: "mobile-430",
      use: { viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    },
  ],
  webServer: REMOTE
    ? undefined
    : [
        {
          command: "node tests/e2e/fake-supabase/server.mjs",
          env: { FAKE_SUPABASE_PORT: String(FAKE_PORT) },
          url: `http://127.0.0.1:${FAKE_PORT}/__test/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        {
          // E2E_DEV=1 uses the dev server for quick iteration; CI and release checks use the production build.
          command: process.env.E2E_DEV ? `npx next dev -p ${APP_PORT}` : `npx next build && npx next start -p ${APP_PORT}`,
          env: appEnv,
          url: `http://127.0.0.1:${APP_PORT}/manifest.webmanifest`,
          reuseExistingServer: !process.env.CI,
          timeout: 400_000,
        },
      ],
});
