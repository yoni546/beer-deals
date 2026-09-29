import { AdminList } from "@/components/admin/AdminUi";
import { EmptyState } from "@/components/Chrome";
import { relativeTimeHe } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";

type Delivery = {
  id: number;
  created_at: string;
  kind: "offer" | "test";
  status: "sent" | "skipped" | "retry" | "failed";
  reason: string | null;
  attempts: number;
  subscriptions_ok: number;
  subscriptions_total: number;
  http_status: number | null;
  beer_name: string | null;
  recipient: string;
};

const STATUS: Record<Delivery["status"], string> = { sent: "נשלחה", skipped: "לא נשלחה", retry: "ממתינה לניסיון נוסף", failed: "נכשלה" };
const REASON: Record<string, string> = {
  cooldown: "בתוך מרווח ההמתנה מההתראה הקודמת על הבירה",
  daily_cap: "הגיע למכסה היומית",
  push_error: "שירות ההתראות של הדפדפן לא הגיב",
  subscription_gone: "המכשיר כבר לא רשום",
};

/**
 * The last fifty attempts: what was sent, to whom (a shortened id — no names, endpoints or
 * message text), and why not. The first place to look when someone says "I never got it".
 */
export async function RecentDeliveries() {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_recent_deliveries", { p_limit: 50 });

  if (error) return <EmptyState title="לא הצלחנו לטעון את ההתראות האחרונות">{error.message}</EmptyState>;
  const rows = (data ?? []) as Delivery[];
  if (rows.length === 0) return <EmptyState title="עוד לא נשלחו התראות">כשתשלחו או תקבלו התראה, היא תופיע כאן.</EmptyState>;

  return (
    <AdminList>
      {rows.map((row) => (
        <article key={row.id} className="px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="min-w-0 truncate text-base font-bold text-ink">
              {row.kind === "test" ? "בדיקה" : (row.beer_name ?? "מבצע")} · <span className="num">{row.recipient}</span>
            </h3>
            <span className="shrink-0 text-sm text-ink-2">{relativeTimeHe(row.created_at)}</span>
          </div>
          <p className="mt-0.5 text-sm text-ink-2">
            <span className={row.status === "sent" ? "font-semibold text-ink" : row.status === "skipped" ? "" : "hatch rounded-full border border-paper-line px-2 py-0.5 font-semibold text-ink"}>
              {STATUS[row.status]}
            </span>
            {row.reason && ` · ${REASON[row.reason] ?? row.reason}`}
            {row.subscriptions_total > 0 && (
              <>
                {" · "}
                <span className="num">
                  {row.subscriptions_ok}/{row.subscriptions_total}
                </span>{" "}
                מכשירים
              </>
            )}
            {row.attempts > 1 && ` · ניסיון ${row.attempts}`}
            {row.http_status && row.status !== "sent" && (
              <>
                {" · "}
                <span className="num">HTTP {row.http_status}</span>
              </>
            )}
          </p>
        </article>
      ))}
    </AdminList>
  );
}
