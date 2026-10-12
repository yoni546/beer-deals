import { formatPrice } from "@/lib/money";
import { relativeTimeHe } from "@/lib/format";
import type { AuditEntry } from "@/lib/admin-queries";

/**
 * One line of the admin audit log (migration 0032).
 *
 * It is written for the question a person actually arrives with — "who took this
 * down, and can we put it back?" — so the action is a sentence, not an enum, and
 * the before-and-after is spelled out rather than dumped as JSON. What the log
 * holds and what the screen can say are deliberately the same thing: if a field
 * cannot be put into words here, it has no business being recorded there.
 */

const ACTION_HE: Record<string, string> = {
  "deal.approve": "אישר מבצע",
  "deal.reject": "דחה מבצע",
  "deal.remove": "הסיר מבצע מהאתר",
  "deal.delete": "מחק מבצע לצמיתות",
  "deal.edit": "ערך מבצע",
  "deal.add": "הוסיף מבצע ידנית",
  "report.close": "סגר דיווח",
  "weekly.set": "קבע מבצע השבוע",
  "weekly.clear": "הסיר את מבצע השבוע",
  "admin.grant": "נתן הרשאת ניהול",
  "admin.change_level": "שינה דרגת ניהול",
  "admin.revoke": "הסיר הרשאת ניהול",
  "settings.notifications": "שינה את כללי ההתראות",
};

/** The actions worth marking: they destroy something, or they hand somebody the keys. */
const WEIGHTY = new Set(["deal.delete", "admin.grant", "admin.change_level", "admin.revoke"]);

const FIELD_HE: Record<string, string> = {
  deal_price_agorot: "מחיר במבצע",
  regular_price_agorot: "מחיר רגיל",
  category: "מארז",
  notes: "הערה",
  beer_id: "בירה",
  store_id: "חנות",
  min_discount_percent: "אחוז הנחה מינימלי",
  max_price_agorot: "מחיר מקסימלי",
  cooldown_hours: "זמן המתנה בין התראות",
  daily_cap: "מקסימום ביום",
  quiet_start: "תחילת שעות שקט",
  quiet_end: "סוף שעות שקט",
  from_level: "מדרגה",
  to_level: "לדרגה",
  from_status: "ממצב",
  to_status: "למצב",
};

const STATUS_HE: Record<string, string> = {
  pending: "ממתין",
  approved: "מאושר",
  rejected: "נדחה",
  inactive: "הוסר",
  open: "פתוח",
  resolved: "טופל",
  dismissed: "נדחה",
};

const LEVEL_HE: Record<string, string> = { admin: "מנהל", super_admin: "מנהל ראשי" };

const AGOROT_FIELDS = new Set(["deal_price_agorot", "regular_price_agorot", "max_price_agorot"]);

/** A single value, in the words of whatever field it belongs to. */
function valueHe(field: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (AGOROT_FIELDS.has(field) && typeof value === "number") return formatPrice(value);
  if (typeof value === "boolean") return value ? "כן" : "לא";
  const text = String(value);
  return STATUS_HE[text] ?? LEVEL_HE[text] ?? text;
}

/**
 * The parts of `details` a person can read, in order.
 *
 * Ids are left out on purpose: a uuid on the screen is noise, and the subject is
 * already named on the line. The one exception is a deletion, where the ids are the
 * only way back — and those are shown as a block below, not inline.
 */
const SKIP = new Set(["beer_id", "store_id", "from_deal_id", "to_deal_id", "deal_id", "submitted_by", "was_approved_by", "was_approved_at", "entered_by_admin"]);

function readableParts(details: Record<string, unknown>): string[] {
  const parts: string[] = [];
  for (const [field, value] of Object.entries(details)) {
    if (SKIP.has(field)) continue;
    const label = FIELD_HE[field] ?? field;
    // A before/after pair, which is how every edit is recorded.
    if (Array.isArray(value) && value.length === 2) {
      parts.push(`${label}: ${valueHe(field, value[0])} → ${valueHe(field, value[1])}`);
      continue;
    }
    if (field === "notify") {
      parts.push(value ? "ביקש לשלוח התראה" : "בלי התראה");
      continue;
    }
    parts.push(`${label}: ${valueHe(field, value)}`);
  }
  return parts;
}

export function AuditEntryRow({ entry }: { entry: AuditEntry }) {
  const parts = readableParts(entry.details);
  const weighty = WEIGHTY.has(entry.action);

  return (
    <article className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-base font-bold text-ink">
          {ACTION_HE[entry.action] ?? entry.action}
          {weighty && (
            // Marked in words and in pattern, never in colour alone.
            <span className="hatch ms-2 rounded-full border border-paper-line px-2 py-0.5 align-middle text-xs font-semibold">
              פעולה כבדה
            </span>
          )}
        </p>
        <time dateTime={entry.at} className="shrink-0 text-sm text-ink-2">
          {relativeTimeHe(entry.at)}
        </time>
      </div>

      <p className="mt-0.5 text-sm text-ink-2">
        {entry.is_me ? "אתם" : (entry.actor_email ?? "מנהל שהחשבון שלו נמחק")}
      </p>

      {parts.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-sm text-ink-2">
          {parts.map((part) => (
            <li key={part}>{part}</li>
          ))}
        </ul>
      )}

      {/* A destroyed row's identifiers: the only path back, so they are kept where
          they can be copied rather than summarised away. */}
      {entry.action === "deal.delete" && (
        <p className="num mt-1.5 text-xs text-ink-2" dir="ltr">
          beer {String(entry.details.beer_id ?? "—")} · store {String(entry.details.store_id ?? "—")}
        </p>
      )}
    </article>
  );
}
