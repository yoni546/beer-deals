import { NextResponse } from "next/server";
import { getViewer } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * The branches whose current promotions file lists a promotion (migration 0017,
 * promotion_branches): name, city, when it was seen — and, since 0039, how far
 * away it is, nearest first.
 *
 * Read through the visitor's own session (RLS); nothing else is exposed. Fetched
 * only when someone opens a deal's "where" sheet, so pages never carry long
 * branch lists.
 *
 * The point from which distance is measured is the viewer's OWN home, read here on
 * the server from their profile. It is never taken from the request: a client-
 * supplied point would let anybody ask "how far is this branch from here?" about
 * somebody else's town, and more importantly it would put a person's home in a URL
 * — in logs, in a referrer, in a shared link.
 *
 * `locatable: false` is a real answer and the sheet says it in words. Branch
 * coordinates are deliberately empty until a geocoder runs (0026), so today that
 * is the answer for everybody.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const [viewer, supabase] = await Promise.all([getViewer(), supabaseServer()]);
  const lat = viewer.profile?.home_lat ?? null;
  const lon = viewer.profile?.home_lon ?? null;

  const { data, error } = await supabase.rpc("promotion_branches_near", {
    p_promotion_id: Number(id),
    p_lat: lat,
    p_lon: lon,
  });
  if (error) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const branches = (data ?? []) as Array<{ km: number | null }>;
  return NextResponse.json(
    {
      branches,
      // Why there are no distances, so the sheet can say which of the two it is
      // rather than showing a list with silent gaps.
      home: lat !== null,
      locatable: branches.some((branch) => branch.km !== null),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
