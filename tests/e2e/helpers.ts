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

/**
 * Fresh database: real migrations + seed, no users, no deals.
 *
 * Also clears the app's shared caches. The catalogue and the feed aggregates are
 * held under FEEDS_TAG for five minutes, and the app has no way to notice that the
 * database underneath it was replaced — so without this, one test's SKU index is
 * served to the next and its deals simply never appear.
 */
export async function resetDb() {
  await post("/__test/reset", {});
  await revalidateAppCaches();
}

/**
 * The same doorbell an ingestion run uses (src/app/api/cache/revalidate/route.ts).
 *
 * Exported because a spec that writes to the database BEHIND the app -- seeding
 * other people's rows, say -- has to ring it for the same reason an import does:
 * the shared feed reads are cached for five minutes and Postgres cannot tell Next
 * that they changed.
 */
export async function revalidateAppCaches() {
  const base = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${process.env.E2E_APP_PORT ?? 3200}`;
  await fetch(`${base}/api/cache/revalidate`, {
    method: "POST",
    headers: { Authorization: "Bearer e2e-cron-secret-not-a-real-one" },
  }).catch(() => undefined);
}

/** Runs several statements at once (seed files). */
export const exec = (query: string) => post("/__test/exec", { sql: query });

/**
 * Rebuild the stored half of the feed, the way an import does.
 *
 * Since 0044 the chain offers are a TABLE (`offers_catalog`), computed once per
 * ingestion run instead of on every page read — that is what took a 15-second feed
 * read down to 49 ms. The consequence for a test: writing a price no longer changes
 * what the app shows. Whatever writes prices behind the app has to do what the import
 * does — rebuild, then ring the cache doorbell.
 *
 * Omitting it is not a visible error. The page simply shows no chain offers, which
 * reads as "the feature is broken": 41 specs failed exactly that way once.
 */
export async function rebuildFeed() {
  await exec("select public.refresh_offers_catalog();");
  await revalidateAppCaches();
}

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
  // Those prices were re-attributed AFTER the seed filled offers_catalog, so the stored
  // feed still describes the catalogue as it was before. Rebuild it.
  await rebuildFeed();
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
  // The list of beers to choose from is one of the cached whole-catalogue reads, and
  // Postgres cannot tell Next that a row appeared. Without this the onboarding step
  // offers the catalogue as it was up to five minutes ago -- and this beer is not in it.
  await revalidateAppCaches();
}

/** Makes the person onboarded under `firstName` an admin (test database only). */
export async function makeAdmin(firstName: string) {
  await exec(
    `insert into public.admins (user_id, level) select id, 'admin' from public.profiles where first_name = '${firstName.replace(/'/g, "''")}'
     on conflict (user_id) do nothing;`,
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
 * Walks the real onboarding UI: name, one to four beers (chosen in ranked order), the ranking
 * step, submit. The default picks four; pass fewer to exercise the 0024 minimum.
 * Leaves the page on the final onboarding step; the caller decides what next.
 */
export async function completeOnboardingSteps(page: Page, name = "בדיקה", beers = ["גולדסטאר", "מכבי", "היינקן", "קורונה"]) {
  await page.goto("/welcome");
  await page.getByPlaceholder("יוני").fill(name);
  await page.getByRole("button", { name: "ממשיכים" }).click();
  for (const beer of beers) {
    await page.locator("button[aria-pressed]", { hasText: beer }).first().click();
  }
  await page.getByRole("button", { name: "לדירוג" }).click();
  // The place step (0026). Skipping it is a real choice, so the default walk skips it.
  await page.getByRole("button", { name: "ממשיכים" }).click();
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

type Finding = string;

/** The quality floor (see quality.spec.ts). Runs in the page. Returns human-readable descriptions of everything that breaks the floor. */
export async function floorViolations(page: Page): Promise<Finding[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const describe = (el: Element, why: string) => {
      const r = el.getBoundingClientRect();
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      return `${why}: <${el.tagName.toLowerCase()}> "${text}" ${Math.round(r.width)}×${Math.round(r.height)}`;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return false; // sr-only and collapsed
      const style = getComputedStyle(el);
      return style.visibility !== "hidden" && style.display !== "none";
    };

    if (document.documentElement.scrollWidth > window.innerWidth + 1) {
      out.push(`sideways scroll: page is ${document.documentElement.scrollWidth}px wide in a ${window.innerWidth}px window`);
    }

    const controls = document.querySelectorAll(
      "a[href], button, summary, select, textarea, [role=button], input:not([type=hidden]):not([type=radio]):not([type=checkbox])",
    );
    for (const el of controls) {
      if (!visible(el)) continue;
      if (el.closest("nextjs-portal, [data-nextjs-toast]")) continue; // the dev-server overlay is not ours
      if (el.closest("details:not([open])") && el.tagName !== "SUMMARY") continue;
      const r = el.getBoundingClientRect();
      if (r.height < 43.5 || r.width < 43.5) out.push(describe(el, "touch target under 44px"));
    }

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || seen.has(el) || !(node.textContent ?? "").trim() || !visible(el)) continue;
      seen.add(el);
      if (el.closest("nextjs-portal, script, style")) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 11.99) out.push(describe(el, `text at ${size}px`));
    }
    return out;
  });
}
