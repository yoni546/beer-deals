import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, startFakeSupabase } from "./e2e/fake-supabase/server.mjs";
import { DEMO_DEAL_NOTE, isProductionEnvironment, WITHOUT_DEMO_DEALS } from "@/lib/demo";

describe("isProductionEnvironment", () => {
  it("is true for a production deployment, however it announces itself", () => {
    expect(isProductionEnvironment({ APP_ENV: "production" })).toBe(true);
    expect(isProductionEnvironment({ VERCEL_ENV: "production" })).toBe(true);
  });

  it("lets APP_ENV override the host's own label", () => {
    expect(isProductionEnvironment({ APP_ENV: "staging", VERCEL_ENV: "production" })).toBe(false);
    expect(isProductionEnvironment({ APP_ENV: "production", VERCEL_ENV: "preview" })).toBe(true);
  });

  it("is false on previews, staging, development and unconfigured machines", () => {
    expect(isProductionEnvironment({ VERCEL_ENV: "preview" })).toBe(false);
    expect(isProductionEnvironment({ APP_ENV: "development" })).toBe(false);
    expect(isProductionEnvironment({})).toBe(false);
  });
});

describe("WITHOUT_DEMO_DEALS (the PostgREST filter)", () => {
  let fake: Awaited<ReturnType<typeof startFakeSupabase>>;

  beforeAll(async () => {
    fake = await startFakeSupabase({ port: 0 });
    const admin = (await fake.query("insert into auth.users (email) values ('a@x.test') returning id")).rows[0].id as string;
    await fake.query("insert into public.admins (user_id, level) values ($1, 'super_admin')", [admin]);
    const add = (beer: string, store: string, notes: string | null) =>
      fake.query(
        `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status, approved_by, approved_at, notes)
         select b.id, s.id, 'sixpack', 2000, 3000, 'approved', $3, now(), $4 from public.beers b, public.stores s where b.slug = $1 and s.slug = $2`,
        [beer, store, admin, notes],
      );
    await add("goldstar", "rami-levy", null); // a real deal with no note
    await add("maccabee", "victory", "עד יום שישי"); // a real deal with a note
    await add("heineken", "shufersal", DEMO_DEAL_NOTE); // sample
    await add("corona", "yochananof", DEMO_DEAL_NOTE); // sample
  }, 120_000);

  afterAll(async () => {
    await fake.close();
  });

  it("drops sample rows and keeps every real deal — including ones with no note at all", async () => {
    const supabase = createClient(fake.url, ANON_KEY);
    const all = await supabase.from("deals_public").select("beer_slug, notes").order("beer_slug");
    expect(all.data).toHaveLength(4);

    const filtered = await supabase.from("deals_public").select("beer_slug").or(WITHOUT_DEMO_DEALS).order("beer_slug");
    expect(filtered.error).toBeNull();
    expect(filtered.data?.map((d) => d.beer_slug)).toEqual(["goldstar", "maccabee"]);
  });
});
