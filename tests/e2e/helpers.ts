import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

const FAKE = `http://127.0.0.1:${process.env.E2E_FAKE_PORT ?? 54321}`;

export const DEMO_NOTE = "מבצע לדוגמה";

async function post(path: string, body: unknown) {
  const response = await fetch(`${FAKE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  return response.json();
}

/** Fresh database: real migrations + seed, no users, no deals. */
export const resetDb = () => post("/__test/reset", {});

/** Runs several statements at once (seed files). */
export const exec = (query: string) => post("/__test/exec", { sql: query });

/**
 * The invented dev/staging catalogue (supabase/seed/dev-catalog.sql): several
 * packs per beer, regular prices at four chains, plain cuts, a club price and two
 * multi-buys. The same file a developer runs on a staging database.
 */
export async function seedCatalog() {
  const file = new URL("../../supabase/seed/dev-catalog.sql", import.meta.url);
  await exec(["set app.allow_demo_seed = 'yes';", readFileSync(file, "utf8")].join(String.fromCharCode(10)));
}

/**
 * The dev catalogue as a production-mode server sees REAL data: every price re-attributed to
 * the 'admin' source, exactly as an administrator's or a chain feed's would be. Beers listed in
 * `sample` keep the 'sample-data' source, so specs can prove that invented prices stay hidden.
 */
export async function seedRealCatalog(options: { sample?: string[] } = {}) {
  await seedCatalog();
  const sampleBeers = (options.sample ?? []).map((slug) => `'${slug.replace(/[^a-z0-9-]/g, "")}'`).join(", ") || "''";
  // The ledger is append-only (that is the point of it), so a test that wants different
  // provenance switches the guard off for one statement, on a throw-away database.
  await exec(
    `alter table public.price_observations disable trigger user;
     update public.price_observations o
        set source_id = (select id from public.sources where slug = 'admin'),
            -- the seed labels its promotions as samples; real ones would not carry that note
            conditions = o.conditions - 'note_he'
      where o.sku_id not in (
        select k.id from public.skus k join public.beers b on b.id = k.beer_id where b.slug in (${sampleBeers})
      );
     alter table public.price_observations enable trigger user;`,
  );
}

export const sql = async <T = Record<string, unknown>>(query: string, params: unknown[] = []) =>
  ((await post("/__test/sql", { sql: query, params })) as { rows: T[] }).rows;

/**
 * A beer with no visual identity of its own (src/design/themes.ts has none for it), in a category the
 * app shows — to prove the neutral fallback. Every real beer in scope has an identity, so the test
 * adds one. Test database only.
 */
export const NO_IDENTITY_BEER = "בירת בדיקה";
export async function addBeerWithoutIdentity() {
  await exec(
    `insert into public.beers (slug, name_he, name_en, theme_base, theme_surface, theme_accent, theme_ink, sort_order, brand_id, variant, category)
     select 'test-no-identity', '${NO_IDENTITY_BEER}', 'Test beer', '#111111', '#222222', '#cccccc', '#ffffff', 99, brand_id, 'test', 'beer'
       from public.beers where slug = 'goldstar'
     on conflict (slug) do nothing;`,
  );
}

export async function createAdmin(email = "admin@example.test", password = "correct-horse") {
  const { id } = (await post("/__test/create-user", { email, password, admin: "super_admin" })) as { id: string };
  return { id, email, password };
}

type SeedDeal = {
  beer: string;
  store: string;
  category: "sixpack" | "case" | "single";
  deal: number;
  regular: number;
  notes?: string | null;
  approved?: boolean;
};

/** Approved deals, attributed to an admin so the audit constraint holds. */
export async function seedDeals(deals: SeedDeal[]) {
  const admin = await createAdmin(`seed-${Math.random().toString(36).slice(2)}@example.test`);
  for (const d of deals) {
    await sql(
      `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, notes, status, approved_by, approved_at, notified_at)
       select b.id, s.id, $3::public.deal_category, $4, $5, $6, 'approved', $7::uuid, now(), now()
         from public.beers b, public.stores s where b.slug = $1 and s.slug = $2`,
      [d.beer, d.store, d.category, d.deal, d.regular, d.notes ?? null, admin.id],
    );
  }
}

export const STANDARD_DEALS: SeedDeal[] = [
  { beer: "goldstar", store: "rami-levy", category: "sixpack", deal: 2490, regular: 3990 },
  { beer: "goldstar", store: "shufersal", category: "sixpack", deal: 2990, regular: 3990 },
  { beer: "maccabee", store: "victory", category: "sixpack", deal: 2690, regular: 3790 },
  { beer: "heineken", store: "shufersal", category: "case", deal: 14900, regular: 19900 },
];

/**
 * Walks the real onboarding UI: name, four ranked beers, submit.
 * Leaves the page on the final onboarding step; the caller decides what next.
 */
export async function completeOnboardingSteps(page: Page, name = "בדיקה", beers = ["גולדסטאר", "מכבי", "היינקן", "קורונה"]) {
  await page.goto("/welcome");
  await page.getByPlaceholder("יוני").fill(name);
  await page.getByRole("button", { name: "ממשיכים" }).click();
  for (const beer of beers) {
    await page.locator("button[aria-pressed]", { hasText: beer }).first().click();
  }
  await page.getByRole("button", { name: "סיימנו" }).click();
}

/** Onboard fully and land on Home. */
export async function onboard(page: Page, name = "בדיקה", beers?: string[]) {
  await completeOnboardingSteps(page, name, beers);
  await page.getByRole("button", { name: /קדימה/ }).click();
  await expect(page).toHaveURL(/\/$/);
}

/**
 * Makes the browser's notification state deterministic. Headless Chromium builds
 * disagree about whether a granted permission sticks, so tests state the world
 * they need instead of inheriting one. Call before the first navigation.
 */
export async function stubBrowserPush(
  page: Page,
  options: { permission?: "granted" | "denied" | "default"; subscribe?: "refuse" | "none" } = {},
) {
  const permission = options.permission ?? "granted";
  const refuse = options.subscribe === "refuse";
  await page.addInitScript(
    ({ permission, refuse }) => {
      Object.defineProperty(Notification, "permission", { get: () => permission, configurable: true });
      Notification.requestPermission = () => Promise.resolve(permission);
      if (refuse) {
        PushManager.prototype.subscribe = () => Promise.reject(new DOMException("push service unavailable", "AbortError"));
      }
    },
    { permission, refuse },
  );
}
