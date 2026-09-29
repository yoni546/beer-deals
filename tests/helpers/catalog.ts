import type { PGlite } from "@electric-sql/pglite";
import { asUser, createUser, freshDatabase } from "./db";

/** ISO timestamp `days` from now (negative = in the past). */
export const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

export type World = Awaited<ReturnType<typeof world>>;

/**
 * A database with the real migrations, one admin, one ordinary user, and helpers
 * for the catalogue. Every test builds its own, because the price ledger is
 * append-only — state left by one test would leak into the next.
 */
export async function world() {
  const db = await freshDatabase();
  const admin = await createUser(db, "admin@example.test");
  await db.query("insert into public.admins (user_id, level) values ($1, 'super_admin')", [admin]);
  const visitor = await createUser(db);

  const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T & Record<string, unknown>>(sql, params)).rows[0] as T;
  const idOf = async (table: "beers" | "stores", slug: string) => (await one<{ id: string }>(`select id from public.${table} where slug = $1`, [slug])).id;

  const ids = {
    goldstar: await idOf("beers", "goldstar"),
    maccabee: await idOf("beers", "maccabee"),
    rami: await idOf("stores", "rami-levy"),
    shufersal: await idOf("stores", "shufersal"),
    victory: await idOf("stores", "victory"),
    yochananof: await idOf("stores", "yochananof"),
  };

  /** A SKU, created the way an admin would (through RLS). */
  async function sku(
    beerId: string,
    container: "bottle" | "can" | "keg" | "draft" | "other",
    volumeMl: number,
    packQuantity: number,
    displayHe = `${container} ${packQuantity}×${volumeMl}`,
  ) {
    return asUser(db, admin, async () => {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.skus (beer_id, container, volume_ml, pack_quantity, display_he)
         values ($1, $2, $3, $4, $5) returning id`,
        [beerId, container, volumeMl, packQuantity, displayHe],
      );
      return rows[0].id;
    });
  }

  async function source(slug: string, kind: "chain_feed" | "admin" | "user_submission" | "scraper" | "import") {
    await db.query("insert into public.sources (slug, name, kind) values ($1, $1, $2) on conflict (slug) do nothing", [slug, kind]);
    return slug;
  }

  type Price = {
    sku: string;
    store: string;
    kind: "regular" | "promotion";
    price?: number | null;
    observedAt?: string;
    source?: string;
    branch?: string | null;
    validFrom?: string | null;
    validTo?: string | null;
    promoType?: "price_cut" | "multi_buy" | "club_price" | "coupon" | "gift" | "other" | null;
    conditions?: Record<string, unknown>;
    naturalKey?: string | null;
    contentHash?: string | null;
    status?: "live" | "held";
    as?: string | null; // whose session; default admin
    role?: "authenticated" | "anon" | "service_role";
  };

  /** record_price() as the given caller. */
  async function record(p: Price) {
    const run = () =>
      db.query<Record<string, unknown> & { id: string }>(
        `select * from public.record_price(
           p_sku_id := $1, p_store_id := $2, p_kind := $3, p_price_agorot := $4, p_observed_at := $5,
           p_source_slug := $6, p_branch_id := $7, p_valid_from := $8, p_valid_to := $9, p_promo_type := $10,
           p_conditions := $11::jsonb, p_natural_key := $12, p_content_hash := $13, p_status := $14)`,
        [
          p.sku, p.store, p.kind, p.price ?? null, p.observedAt ?? inDays(0), p.source ?? "admin", p.branch ?? null,
          p.validFrom ?? null, p.validTo ?? null, p.promoType ?? null, JSON.stringify(p.conditions ?? {}),
          p.naturalKey ?? null, p.contentHash ?? null, p.status ?? "live",
        ],
      );
    const rows = await asUser(db, p.as === undefined ? admin : p.as, run, p.role ?? "authenticated");
    return rows.rows[0];
  }

  /** A read as an anonymous visitor — what the public site can see. */
  const asPublic = <T>(work: () => Promise<T>) => asUser(db, null, work, "anon");

  const offers = async (where = "true", params: unknown[] = []) =>
    (await asPublic(() => db.query<Record<string, unknown>>(`select * from public.offers_ranked where ${where} order by effective_agorot`, params))).rows;

  return { db, admin, visitor, ids, one, sku, source, record, asPublic, offers };
}

export type Db = PGlite;
