import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createUser, freshDatabase } from "./helpers/db";

/**
 * The rules the spec is most emphatic about, tested against the real schema:
 *
 *   * a submitted deal is never published automatically,
 *   * a user report never removes a deal,
 *   * regular users cannot approve, edit or delete deals,
 *   * only a super admin can create or destroy admins.
 *
 * Each one is asserted from inside a non-superuser session, because RLS does
 * not apply to a superuser and a test that forgets that proves nothing.
 */

let db: PGlite;
let beerId: string;
let storeId: string;
let storeIds: string[] = [];
let shelf = 0;

beforeAll(async () => {
  db = await freshDatabase();
  beerId = (
    await db.query<{ id: string }>("select id from public.beers where slug = 'goldstar'")
  ).rows[0].id;
  storeId = (
    await db.query<{ id: string }>("select id from public.stores where slug = 'rami-levy'")
  ).rows[0].id;
  storeIds = (await db.query<{ id: string }>("select id from public.stores order by slug")).rows.map(
    (row) => row.id,
  );
});

afterAll(async () => {
  await db?.close();
});

/**
 * Each call lands on a different shop, because only one approved deal may exist
 * per beer + shop + pack size (0005). Tests that need a specific shelf pass the
 * store explicitly.
 */
async function insertDeal(
  status = "pending",
  createdBy: string | null = null,
  store: string | null = null,
) {
  const result = await db.query<{ id: string }>(
    `insert into public.deals
       (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status,
        created_by, approved_by, approved_at)
     values ($1, $2, 'sixpack', 2490, 3990, $3, $4, $5, $6)
     returning id`,
    [
      beerId,
      store ?? storeIds[shelf++ % storeIds.length],
      status,
      createdBy,
      status === "approved" ? createdBy : null,
      status === "approved" ? new Date().toISOString() : null,
    ],
  );
  return result.rows[0].id;
}

describe("deal pricing", () => {
  it("computes the discount itself, to the nearest percent", async () => {
    const id = await insertDeal();
    const { rows } = await db.query<{ discount_percent: number }>(
      "select discount_percent from public.deals where id = $1",
      [id],
    );
    // (3990 - 2490) / 3990 = 37.59%
    expect(rows[0].discount_percent).toBe(38);
  });

  it("refuses a deal price that is not below the regular price", async () => {
    await expect(
      db.query(
        `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot)
         values ($1, $2, 'sixpack', 3990, 3990)`,
        [beerId, storeId],
      ),
    ).rejects.toThrow(/deals_price_is_a_discount/);
  });

  it("refuses to call a deal approved without recording who approved it", async () => {
    await expect(
      db.query(
        `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status)
         values ($1, $2, 'sixpack', 2490, 3990, 'approved')`,
        [beerId, storeId],
      ),
    ).rejects.toThrow(/deals_approved_is_attributed/);
  });
});

describe("submissions are never published automatically", () => {
  it("lets a signed-in user submit a pending deal", async () => {
    const userId = await createUser(db);
    await asUser(db, userId, async () => {
      await db.query(
        `insert into public.deals
           (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, created_by, status)
         values ($1, $2, 'sixpack', 2490, 3990, $3, 'pending')`,
        [beerId, storeId, userId],
      );
    });

    const { rows } = await db.query<{ count: string }>(
      "select count(*) from public.deals where created_by = $1 and status = 'pending'",
      [userId],
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it("refuses a submission that tries to publish itself", async () => {
    const userId = await createUser(db);
    await asUser(db, userId, async () => {
      await expect(
        db.query(
          `insert into public.deals
             (beer_id, store_id, category, deal_price_agorot, regular_price_agorot,
              created_by, status, approved_by, approved_at)
           values ($1, $2, 'sixpack', 2490, 3990, $3, 'approved', $3, now())`,
          [beerId, storeId, userId],
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("refuses a submission attributed to somebody else", async () => {
    const userId = await createUser(db);
    const otherId = await createUser(db);
    await asUser(db, userId, async () => {
      await expect(
        db.query(
          `insert into public.deals
             (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, created_by, status)
           values ($1, $2, 'sixpack', 2490, 3990, $3, 'pending')`,
          [beerId, storeId, otherId],
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("hides a pending deal from everyone but its author", async () => {
    const author = await createUser(db);
    const stranger = await createUser(db);
    const dealId = await insertDeal("pending", author);

    const seenByAuthor = await asUser(db, author, () =>
      db.query("select id from public.deals where id = $1", [dealId]),
    );
    expect(seenByAuthor.rows).toHaveLength(1);

    const seenByStranger = await asUser(db, stranger, () =>
      db.query("select id from public.deals where id = $1", [dealId]),
    );
    expect(seenByStranger.rows).toHaveLength(0);

    const seenByAnon = await asUser(
      db,
      null,
      () => db.query("select id from public.deals where id = $1", [dealId]),
      "anon",
    );
    expect(seenByAnon.rows).toHaveLength(0);
  });
});

describe("only admins moderate", () => {
  it("refuses approve_deal for a regular user", async () => {
    const userId = await createUser(db);
    const dealId = await insertDeal("pending", userId);

    await asUser(db, userId, async () => {
      await expect(db.query("select public.approve_deal($1)", [dealId])).rejects.toThrow(
        /moderator privileges required/,
      );
    });
  });

  it("silently changes nothing when a regular user updates a deal directly", async () => {
    const author = await createUser(db);
    const dealId = await insertDeal("pending", author);

    await asUser(db, author, async () => {
      // No UPDATE policy applies, so the statement matches zero rows rather
      // than raising. The deal must still be pending afterwards.
      await db.query("update public.deals set status = 'approved' where id = $1", [dealId]);
    });

    const { rows } = await db.query<{ status: string }>(
      "select status from public.deals where id = $1",
      [dealId],
    );
    expect(rows[0].status).toBe("pending");
  });

  it("lets an admin approve, and records who and when", async () => {
    const adminId = await createUser(db, "admin@example.com");
    await db.query("insert into public.admins (user_id, level) values ($1, 'admin')", [adminId]);
    const dealId = await insertDeal("pending", await createUser(db));

    await asUser(db, adminId, async () => {
      await db.query("select public.approve_deal($1)", [dealId]);
    });

    const { rows } = await db.query<{
      status: string;
      approved_by: string;
      approved_at: string | null;
    }>("select status, approved_by, approved_at from public.deals where id = $1", [dealId]);

    expect(rows[0].status).toBe("approved");
    expect(rows[0].approved_by).toBe(adminId);
    expect(rows[0].approved_at).not.toBeNull();
  });

  it("shows an approved deal to a signed-out visitor", async () => {
    const adminId = await createUser(db, "admin2@example.com");
    await db.query("insert into public.admins (user_id, level) values ($1, 'admin')", [adminId]);
    const dealId = await insertDeal("pending", await createUser(db));
    await asUser(db, adminId, () => db.query("select public.approve_deal($1)", [dealId]));

    const visible = await asUser(
      db,
      null,
      () => db.query("select id from public.deals_public where id = $1", [dealId]),
      "anon",
    );
    expect(visible.rows).toHaveLength(1);
  });
});

describe("reports never remove a deal", () => {
  it("leaves the deal approved after a report is filed", async () => {
    const adminId = await createUser(db, "admin3@example.com");
    await db.query("insert into public.admins (user_id, level) values ($1, 'admin')", [adminId]);
    const dealId = await insertDeal("pending", await createUser(db));
    await asUser(db, adminId, () => db.query("select public.approve_deal($1)", [dealId]));

    const reporter = await createUser(db);
    await asUser(db, reporter, async () => {
      await db.query(
        "insert into public.deal_reports (deal_id, reported_by, status) values ($1, $2, 'open')",
        [dealId, reporter],
      );
    });

    const { rows } = await db.query<{ status: string }>(
      "select status from public.deals where id = $1",
      [dealId],
    );
    expect(rows[0].status).toBe("approved");
  });

  it("refuses a second open report from the same person", async () => {
    const adminId = await createUser(db, "admin4@example.com");
    await db.query("insert into public.admins (user_id, level) values ($1, 'admin')", [adminId]);
    const dealId = await insertDeal("pending", await createUser(db));
    await asUser(db, adminId, () => db.query("select public.approve_deal($1)", [dealId]));

    const reporter = await createUser(db);
    await asUser(db, reporter, async () => {
      await db.query(
        "insert into public.deal_reports (deal_id, reported_by, status) values ($1, $2, 'open')",
        [dealId, reporter],
      );
      await expect(
        db.query(
          "insert into public.deal_reports (deal_id, reported_by, status) values ($1, $2, 'open')",
          [dealId, reporter],
        ),
      ).rejects.toThrow(/duplicate key|unique/i);
    });
  });

  it("refuses to resolve a report without admin rights", async () => {
    const adminId = await createUser(db, "admin5@example.com");
    await db.query("insert into public.admins (user_id, level) values ($1, 'admin')", [adminId]);
    const dealId = await insertDeal("pending", await createUser(db));
    await asUser(db, adminId, () => db.query("select public.approve_deal($1)", [dealId]));

    const reporter = await createUser(db);
    const reportId = (
      await asUser(db, reporter, () =>
        db.query<{ id: string }>(
          "insert into public.deal_reports (deal_id, reported_by, status) values ($1, $2, 'open') returning id",
          [dealId, reporter],
        ),
      )
    ).rows[0].id;

    await asUser(db, reporter, async () => {
      await expect(
        db.query("select public.resolve_report($1, 'resolved')", [reportId]),
      ).rejects.toThrow(/moderator privileges required/);
    });
  });
});

describe("only a super admin manages admins", () => {
  it("refuses grant_admin for a regular admin", async () => {
    const adminId = await createUser(db, "plain@example.com");
    await db.query("insert into public.admins (user_id, level) values ($1, 'admin')", [adminId]);
    await createUser(db, "hopeful@example.com");

    await asUser(db, adminId, async () => {
      await expect(
        db.query("select public.grant_admin('hopeful@example.com', 'admin')"),
      ).rejects.toThrow(/super admin privileges required/);
    });
  });

  it("refuses a direct insert into admins even for a super admin", async () => {
    const superId = await createUser(db, "super@example.com");
    await db.query("insert into public.admins (user_id, level) values ($1, 'super_admin')", [
      superId,
    ]);
    const target = await createUser(db, "target@example.com");

    // Refused twice over: no INSERT privilege is granted on public.admins, and
    // there is no INSERT policy either. Postgres stops at the first of those,
    // so the message names the privilege rather than RLS. The table is writable
    // only through the SECURITY DEFINER functions.
    await asUser(db, superId, async () => {
      await expect(
        db.query("insert into public.admins (user_id, level) values ($1, 'admin')", [target]),
      ).rejects.toThrow(/permission denied|row-level security/i);
    });
  });

  it("lets a super admin grant and revoke through the functions", async () => {
    const superId = await createUser(db, "super2@example.com");
    await db.query("insert into public.admins (user_id, level) values ($1, 'super_admin')", [
      superId,
    ]);
    const target = await createUser(db, "newadmin@example.com");

    await asUser(db, superId, async () => {
      await db.query("select public.grant_admin('newadmin@example.com', 'admin')");
    });

    let roster = await db.query<{ level: string }>(
      "select level from public.admins where user_id = $1",
      [target],
    );
    expect(roster.rows[0].level).toBe("admin");

    await asUser(db, superId, async () => {
      await db.query("select public.revoke_admin($1)", [target]);
    });

    roster = await db.query("select level from public.admins where user_id = $1", [target]);
    expect(roster.rows).toHaveLength(0);
  });

  it("refuses to let a super admin remove themselves", async () => {
    const superId = await createUser(db, "super3@example.com");
    await db.query("insert into public.admins (user_id, level) values ($1, 'super_admin')", [
      superId,
    ]);

    await asUser(db, superId, async () => {
      await expect(db.query("select public.revoke_admin($1)", [superId])).rejects.toThrow(
        /cannot remove yourself/,
      );
    });
  });
});

describe("preferences", () => {
  it("derives the primary beer from favourite rank 1", async () => {
    const userId = await createUser(db);
    const beers = await db.query<{ id: string }>(
      "select id from public.beers order by sort_order limit 4",
    );
    const ids = beers.rows.map((row) => row.id);

    await asUser(db, userId, async () => {
      await db.query("select public.save_preferences('יוני', $1::uuid[])", [ids]);
    });

    const { rows } = await db.query<{ primary_beer_id: string; first_name: string }>(
      "select primary_beer_id, first_name from public.profiles where id = $1",
      [userId],
    );
    expect(rows[0].primary_beer_id).toBe(ids[0]);
    expect(rows[0].first_name).toBe("יוני");
  });

  // 0024: one to four. Rank 1 is still the Primary Beer whatever the count.
  it("takes one, two, three or four distinct beers, and ranks them in the order given", async () => {
    const beers = await db.query<{ id: string }>(
      "select id from public.beers order by sort_order limit 4",
    );
    const ids = beers.rows.map((row) => row.id);

    for (const count of [1, 2, 3, 4]) {
      const userId = await createUser(db);
      const chosen = ids.slice(0, count);

      await asUser(db, userId, async () => {
        await db.query("select public.save_preferences('יוני', $1::uuid[])", [chosen]);
      });

      const { rows } = await db.query<{ beer_id: string; rank: number }>(
        "select beer_id, rank from public.user_favorite_beers where profile_id = $1 order by rank",
        [userId],
      );
      expect(rows.map((row) => row.beer_id)).toEqual(chosen);
      expect(rows.map((row) => row.rank)).toEqual(chosen.map((_, i) => i + 1));

      // The Primary Beer is rank 1 at every count, kept by the trigger, never by app code.
      const profile = await db.query<{ primary_beer_id: string; onboarded_at: string | null }>(
        "select primary_beer_id, onboarded_at from public.profiles where id = $1",
        [userId],
      );
      expect(profile.rows[0].primary_beer_id).toBe(chosen[0]);
      expect(profile.rows[0].onboarded_at).not.toBeNull();
    }
  });

  it("refuses none, more than four, or a repeated beer", async () => {
    const userId = await createUser(db);
    const beers = await db.query<{ id: string }>(
      "select id from public.beers order by sort_order limit 5",
    );
    const ids = beers.rows.map((row) => row.id);

    await asUser(db, userId, async () => {
      await expect(
        db.query("select public.save_preferences('יוני', $1::uuid[])", [[]]),
      ).rejects.toThrow(/between one and four/);

      await expect(
        db.query("select public.save_preferences('יוני', $1::uuid[])", [ids.slice(0, 5)]),
      ).rejects.toThrow(/between one and four/);

      await expect(
        db.query("select public.save_preferences('יוני', $1::uuid[])", [
          [ids[0], ids[0], ids[1], ids[2]],
        ]),
      ).rejects.toThrow(/must be different/);
    });
  });

  // The silent onboarding loop: an UPDATE against a row that is not there used to
  // report success, leaving onboarded_at null and /welcome unescapable.
  it("does not report success when the profile row is missing — it creates it", async () => {
    const userId = await createUser(db);
    const beers = await db.query<{ id: string }>("select id from public.beers order by sort_order limit 2");
    const ids = beers.rows.map((row) => row.id);

    await db.query("delete from public.profiles where id = $1", [userId]);

    await asUser(db, userId, async () => {
      await db.query("select public.save_preferences('יוני', $1::uuid[])", [ids]);
    });

    const { rows } = await db.query<{ onboarded_at: string | null }>(
      "select onboarded_at from public.profiles where id = $1",
      [userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].onboarded_at).not.toBeNull();
  });

  it("keeps one profile from reading another", async () => {
    const mine = await createUser(db);
    const theirs = await createUser(db);

    const { rows } = await asUser(db, mine, () =>
      db.query("select id from public.profiles where id = $1", [theirs]),
    );
    expect(rows).toHaveLength(0);
  });
});

describe("the weekly deal", () => {
  it("refuses a deal that is not approved", async () => {
    const adminId = await createUser(db, "admin6@example.com");
    await db.query("insert into public.admins (user_id, level) values ($1, 'admin')", [adminId]);
    const pendingId = await insertDeal("pending", await createUser(db));

    await asUser(db, adminId, async () => {
      await expect(db.query("select public.set_weekly_deal($1)", [pendingId])).rejects.toThrow(
        /must be an approved deal/,
      );
    });
  });

  it("clears itself when the featured deal is taken down", async () => {
    const adminId = await createUser(db, "admin7@example.com");
    await db.query("insert into public.admins (user_id, level) values ($1, 'admin')", [adminId]);
    const dealId = await insertDeal("pending", await createUser(db));

    await asUser(db, adminId, async () => {
      await db.query("select public.approve_deal($1)", [dealId]);
      await db.query("select public.set_weekly_deal($1)", [dealId]);
      await db.query("select public.set_deal_status($1, 'inactive')", [dealId]);
    });

    const { rows } = await db.query<{ weekly_deal_id: string | null }>(
      "select weekly_deal_id from public.app_settings where id",
    );
    expect(rows[0].weekly_deal_id).toBeNull();
  });
});

describe("one approved deal per shelf", () => {
  it("refuses to approve a second deal for the same beer, shop and pack", async () => {
    const adminId = await createUser(db, "admin8@example.com");
    await db.query("insert into public.admins (user_id, level) values ($1, 'admin')", [adminId]);

    const shopId = (
      await db.query<{ id: string }>("select id from public.stores where slug = 'carrefour'")
    ).rows[0].id;

    const first = await insertDeal("pending", await createUser(db), shopId);
    const second = await insertDeal("pending", await createUser(db), shopId);

    await asUser(db, adminId, async () => {
      await db.query("select public.approve_deal($1)", [first]);

      // The same beer at the same shop in the same size is one deal. Two of
      // them on the shelf means the user sees the line twice, possibly at two
      // different prices, with no way to tell which is true.
      await expect(db.query("select public.approve_deal($1)", [second])).rejects.toThrow(
        /כבר יש מבצע מאושר/,
      );
    });
  });

  it("lets the replacement through once the old one is taken down", async () => {
    const adminId = await createUser(db, "admin9@example.com");
    await db.query("insert into public.admins (user_id, level) values ($1, 'admin')", [adminId]);

    // A shop no other test has put a deal in (the rotation over seeded stores changes as chains are added).
    const shopId = (
      await db.query<{ id: string }>("insert into public.stores (slug, name_he) values ('test-replacement-shop', 'חנות בדיקה') returning id")
    ).rows[0].id;

    const oldDeal = await insertDeal("pending", await createUser(db), shopId);
    const newDeal = await insertDeal("pending", await createUser(db), shopId);

    await asUser(db, adminId, async () => {
      await db.query("select public.approve_deal($1)", [oldDeal]);
      await db.query("select public.set_deal_status($1, 'inactive')", [oldDeal]);
      await db.query("select public.approve_deal($1)", [newDeal]);
    });

    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.deals where store_id = $1 and status = 'approved'",
      [shopId],
    );
    expect(rows[0].n).toBe(1);
  });
});
