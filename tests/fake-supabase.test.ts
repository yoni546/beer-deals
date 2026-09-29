import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ANON_KEY, startFakeSupabase } from "./e2e/fake-supabase/server.mjs";

/**
 * The fake Supabase server is test infrastructure that later tests trust, so it
 * gets tested against the real supabase-js client the app itself uses. If these
 * pass, "the e2e suite is green" means something.
 */
type Fake = Awaited<ReturnType<typeof startFakeSupabase>>;

let fake: Fake;
const client = (): SupabaseClient =>
  createClient(fake.url, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

beforeAll(async () => {
  fake = await startFakeSupabase({ port: 0 });
}, 120_000);

afterAll(async () => {
  await fake.close();
});

describe("fake supabase: auth", () => {
  it("creates anonymous users that RLS can identify", async () => {
    const supabase = client();
    const { data, error } = await supabase.auth.signInAnonymously();
    expect(error).toBeNull();
    expect(data.user?.is_anonymous).toBe(true);

    const me = await supabase.auth.getUser();
    expect(me.data.user?.id).toBe(data.user?.id);

    // handle_new_user() trigger made the profile; RLS lets the owner read it.
    const profile = await supabase.from("profiles").select("id, notifications_enabled").eq("id", data.user!.id).maybeSingle();
    expect(profile.error).toBeNull();
    expect(profile.data?.id).toBe(data.user?.id);
  });

  it("rejects a wrong admin password with a generic error", async () => {
    const supabase = client();
    const { error } = await supabase.auth.signInWithPassword({ email: "nobody@example.com", password: "x" });
    expect(error?.message).toMatch(/invalid/i);
  });
});

describe("fake supabase: PostgREST subset", () => {
  it("reads the seeded catalogue as anon, ordered and limited", async () => {
    const { data, error } = await client().from("beers").select("slug, name_he").eq("is_active", true).order("sort_order").limit(3);
    expect(error).toBeNull();
    expect(data?.map((b) => b.slug)).toEqual(["goldstar", "maccabee", "heineken"]);
  });

  it("returns null (not an error) for maybeSingle() with no rows", async () => {
    const { data, error } = await client().from("beers").select("*").eq("slug", "no-such-beer").maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("supports in(), neq() and or() filters", async () => {
    const supabase = client();
    const inList = await supabase.from("beers").select("slug").in("slug", ["goldstar", "corona"]).order("slug");
    expect(inList.data?.map((b) => b.slug)).toEqual(["corona", "goldstar"]);

    const notGold = await supabase.from("beers").select("slug").neq("slug", "goldstar").limit(50);
    expect(notGold.data?.some((b) => b.slug === "goldstar")).toBe(false);

    const either = await supabase.from("stores").select("slug").or('slug.eq.rami-levy,slug.eq."shufersal"').order("slug");
    expect(either.data?.map((s) => s.slug)).toEqual(["rami-levy", "shufersal"]);
  });

  it("embeds related rows the way session.ts and notify.ts ask for them", async () => {
    const supabase = client();
    const { data: auth } = await supabase.auth.signInAnonymously();
    const beers = (await supabase.from("beers").select("id, slug").in("slug", ["goldstar", "maccabee", "heineken", "corona"])).data!;
    const bySlug = Object.fromEntries(beers.map((b) => [b.slug, b.id]));

    const saved = await supabase.rpc("save_preferences", {
      p_first_name: "Fake",
      p_beer_ids: [bySlug.corona, bySlug.goldstar, bySlug.maccabee, bySlug.heineken],
    });
    expect(saved.error).toBeNull();

    const favourites = await supabase.from("user_favorite_beers").select("rank, beers(*)").eq("profile_id", auth.user!.id).order("rank");
    expect(favourites.error).toBeNull();
    expect((favourites.data as unknown as Array<{ beers: { slug: string } }>).map((f) => f.beers.slug)).toEqual([
      "corona", "goldstar", "maccabee", "heineken",
    ]);

    const profile = await supabase.from("profiles").select("primary_beer_id, onboarded_at").eq("id", auth.user!.id).maybeSingle();
    expect(profile.data?.primary_beer_id).toBe(bySlug.corona); // trigger ran
    expect(profile.data?.onboarded_at).not.toBeNull();
  });

  it("enforces row level security like the real thing", async () => {
    const supabase = client();
    await supabase.auth.signInAnonymously();
    const [beer] = (await supabase.from("beers").select("id").limit(1)).data!;
    const [store] = (await supabase.from("stores").select("id").limit(1)).data!;
    const me = (await supabase.auth.getUser()).data.user!.id;

    // A crafted insert asking to be published is refused (42501)…
    const forged = await supabase.from("deals").insert({
      beer_id: beer.id, store_id: store.id, category: "sixpack",
      deal_price_agorot: 100, regular_price_agorot: 200,
      status: "approved", created_by: me,
    });
    expect(forged.error?.code).toBe("42501");

    // …while a pending submission is accepted and invisible to anon.
    const ok = await supabase.from("deals").insert({
      beer_id: beer.id, store_id: store.id, category: "sixpack",
      deal_price_agorot: 100, regular_price_agorot: 200, status: "pending", created_by: me,
    });
    expect(ok.error).toBeNull();
    const anonView = await createClient(fake.url, ANON_KEY).from("deals_public").select("id");
    expect(anonView.data).toEqual([]);
  });

  it("maps database errors through with their codes", async () => {
    const supabase = client();
    await supabase.auth.signInAnonymously();
    const { error } = await supabase.rpc("approve_deal", { p_deal_id: "00000000-0000-0000-0000-000000000000" });
    expect(error?.code).toBe("42501");
  });
});

describe("fake supabase: the catalogue model as the app's client sees it", () => {
  it("serves offers_feed through supabase-js with unit prices, references and sample flags", async () => {
    const supabase = client();
    // (the dev seed is what a staging database gets; here it exercises the views over HTTP)
    const seed = (await import("node:fs")).readFileSync(new URL("../supabase/seed/dev-catalog.sql", import.meta.url), "utf8");
    await fetch(`${fake.url}/__test/exec`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sql: "set app.allow_demo_seed = 'yes';\n" + seed }),
    });

    const { data, error } = await supabase
      .from("offers_feed")
      .select("beer_slug, store_slug, pack_label, volume_ml, pack_quantity, effective_agorot, reference_agorot, value_pct, unit_price_per_liter_agorot, is_sample")
      .eq("beer_slug", "goldstar")
      .eq("store_slug", "rami-levy")
      .order("effective_agorot", { ascending: true });

    expect(error).toBeNull();
    // Three Goldstar packs are on offer at Rami Levy — three different rows, not one "shelf".
    expect(data?.map((r) => [r.volume_ml, r.pack_quantity, r.effective_agorot])).toEqual([
      [330, 6, 2500],
      [500, 6, 4000],
      [330, 24, 8900],
    ]);
    expect(data?.[0]).toMatchObject({ reference_agorot: 3790, value_pct: 34, is_sample: true });
  });

  it("does not let the public write prices, and lets an administrator do it through record_price", async () => {
    const anon = client();
    await anon.auth.signInAnonymously();
    const [sku] = (await anon.from("skus").select("id").limit(1)).data!;
    const [store] = (await anon.from("stores").select("id").limit(1)).data!;

    const denied = await anon.rpc("record_price", {
      p_sku_id: sku.id, p_store_id: store.id, p_kind: "regular", p_price_agorot: 100,
      p_observed_at: new Date().toISOString(), p_source_slug: "admin",
    });
    expect(denied.error?.code).toBe("42501");
    const direct = await anon.from("price_observations").insert({ sku_id: sku.id, store_id: store.id, kind: "regular", price_agorot: 1, observed_at: new Date().toISOString(), identity_key: "regular", source_id: "00000000-0000-0000-0000-000000000000" });
    expect(direct.error?.code).toBe("42501");

    await fetch(`${fake.url}/__test/create-user`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "boss@example.test", password: "pw-123456", admin: "super_admin" }),
    });
    const admin = client();
    expect((await admin.auth.signInWithPassword({ email: "boss@example.test", password: "pw-123456" })).error).toBeNull();
    const ok = await admin.rpc("record_price", {
      p_sku_id: sku.id, p_store_id: store.id, p_kind: "regular", p_price_agorot: 4321,
      p_observed_at: new Date().toISOString(), p_source_slug: "admin",
      p_conditions: { note_he: "בדיקה" },
    });
    expect(ok.error).toBeNull();
    expect(ok.data).toMatchObject({ price_agorot: 4321, status: "live", kind: "regular" });
  });
});
