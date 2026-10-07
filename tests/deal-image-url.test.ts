import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { world } from "./helpers/catalog";
import { asUser } from "./helpers/db";

/**
 * M-1: a deal's attached photo must be a photo.
 *
 * `image_url` is supplied by anyone — every visitor gets an anonymous session — and
 * is rendered to a MODERATOR as a clickable link. Submit a perfectly valid deal with
 * `javascript:...`, wait for an admin to click "view the attached photo", and that
 * scheme executes in the current document regardless of target="_blank": script
 * execution inside a super-admin's session, one server-action call from grant_admin.
 *
 * Three layers, because this one is worth belt and braces.
 */

describe("the submission schema pins it to our own bucket", () => {
  const source = readFileSync("src/lib/actions/deals.ts", "utf8");

  it("no longer accepts any string at all", () => {
    expect(source).not.toMatch(/imageUrl: z\.string\(\)\.optional\(\)/);
  });

  it("requires a real URL under this project's public deal-images prefix", () => {
    expect(source).toContain("DEAL_IMAGE_PREFIX");
    expect(source).toContain("/storage/v1/object/public/deal-images/");
    expect(source).toMatch(/\.url\(/);
    expect(source).toMatch(/startsWith\(DEAL_IMAGE_PREFIX\)/);
  });
});

describe("the admin panel will not render a link it cannot vouch for", () => {
  const source = readFileSync("src/components/admin/DealActions.tsx", "utf8");

  it("parses the value and insists on https before it becomes an href", () => {
    expect(source).toMatch(/new URL\(raw\)\.protocol === "https:"/);
    // And the raw column value never reaches the attribute.
    expect(source).not.toMatch(/href=\{deal\.image_url\}/);
  });

  it("opens it without handing the new tab a window reference", () => {
    expect(source).toContain('rel="noreferrer noopener"');
  });
});

describe("and the table refuses to hold one either", () => {
  it("rejects javascript:, data: and a bare path, whatever wrote them", async () => {
    const w = await world();
    for (const bad of [
      "javascript:fetch('/x')",
      "data:text/html;base64,PHNjcmlwdD4=",
      "http://attacker.example/photo.jpg",
      "/admin/queue",
    ]) {
      await expect(
        w.db.query(
          `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status, image_url)
           values ($1, $2, 'sixpack', 2490, 3990, 'pending', $3)`,
          [w.ids.goldstar, w.ids.rami, bad],
        ),
        bad,
      ).rejects.toThrow(/deals_image_url_is_https/);
    }
  });

  it("takes an https photo, and no photo at all", async () => {
    const w = await world();
    await w.db.query(
      `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status, image_url)
       values ($1, $2, 'sixpack', 2490, 3990, 'pending', 'https://example.supabase.co/storage/v1/object/public/deal-images/u/p.jpg')`,
      [w.ids.goldstar, w.ids.rami],
    );
    await w.db.query(
      `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status)
       values ($1, $2, 'case', 2490, 3990, 'pending')`,
      [w.ids.goldstar, w.ids.rami],
    );
    const { rows } = await w.db.query<{ n: number }>("select count(*)::int n from public.deals");
    expect(rows[0].n).toBe(2);
  });

  it("still cannot be smuggled in by a submitting user through RLS", async () => {
    const w = await world();
    await expect(
      asUser(w.db, w.visitor, () =>
        w.db.query(
          `insert into public.deals (beer_id, store_id, category, deal_price_agorot, regular_price_agorot, status, created_by, image_url)
           values ($1, $2, 'sixpack', 2490, 3990, 'pending', $3, 'javascript:alert(1)')`,
          [w.ids.goldstar, w.ids.rami, w.visitor],
        ),
      ),
    ).rejects.toThrow(/deals_image_url_is_https/);
  });
});
