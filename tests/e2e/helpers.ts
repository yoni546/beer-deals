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

export const sql = async <T = Record<string, unknown>>(query: string, params: unknown[] = []) =>
  ((await post("/__test/sql", { sql: query, params })) as { rows: T[] }).rows;

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
