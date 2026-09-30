import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * The branches whose current promotions file lists a promotion (migration 0017, promotion_branches):
 * name, city and when it was seen. Read through the visitor's own session (RLS); nothing else is exposed.
 * Fetched only when someone opens a deal's "where" sheet, so pages never carry long branch lists.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("promotion_branches")
    .select("branch_name, branch_city, observed_at")
    .eq("promotion_id", Number(id))
    .order("branch_name")
    .limit(1000);
  if (error) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  return NextResponse.json({ branches: data ?? [] }, { headers: { "cache-control": "no-store" } });
}
