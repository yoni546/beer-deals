import { Chip, ChipRow } from "@/components/ui/Chip";
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon } from "@/components/ui/icons";
import type { PackFilter, SortMode } from "@/lib/offer-logic";
import { withParams } from "@/lib/urls";

export type ViewState = {
  sort: SortMode;
  perLiter: boolean;
  pack: PackFilter;
  /** Any other parameters to carry along untouched (view, mine, …). */
  extra?: Record<string, string | undefined>;
};

const DEFAULTS = { sort: "value", unit: "", pack: "all" };

const PACK_LABEL: Record<PackFilter, string> = { all: "כל האריזות", single: "בודדים", multi: "מארזים", case: "ארגזים" };
const SORT_LABEL: Record<SortMode, string> = { value: "משתלם", price_asc: "מחיר", price_desc: "מחיר" };

const SORT_SUMMARY: Record<SortMode, string> = { value: "הכי משתלם", price_asc: "מחיר, מהזול", price_desc: "מחיר, מהיקר" };

/**
 * Sort and filter, folded into ONE quiet control that says what is active ("מיון: הכי משתלם ·
 * מארזים"); the options open under it. Everything is a link to "this page with one thing changed"
 * (src/lib/urls.ts), so state is in the URL and it works with no script at all (native <details>).
 * A page's own primary toggle (the store page's "my beers") stays outside, in plain view.
 *
 *   משתלם | מחיר ↑ | מחיר ↓ | לליטר             how to order
 *   כל האריזות | בודדים | מארזים | ארגזים      which packs
 */
export function SortBar({
  path,
  state,
  sorting = true,
  packs = true,
  availablePacks,
  leading,
}: {
  path: string;
  state: ViewState;
  /** Show the ordering chips. Off for lists that have one natural order (regular prices). */
  sorting?: boolean;
  packs?: boolean;
  /** Pack kinds that actually have offers, so a chip never leads to an empty page. */
  availablePacks?: PackFilter[];
  /** A page-specific chip that leads the filter row (the store page's "my beers"). */
  leading?: React.ReactNode;
}) {
  const current: Record<string, string | undefined> = {
    ...state.extra,
    sort: state.sort,
    unit: state.perLiter ? "1" : "",
    pack: state.pack,
  };
  const href = (patch: Record<string, string | undefined>) => withParams(path, current, patch, DEFAULTS);
  const summary = [
    sorting ? SORT_SUMMARY[state.sort] : null,
    state.perLiter ? "לליטר" : null,
    packs && state.pack !== "all" ? PACK_LABEL[state.pack] : null,
  ].filter(Boolean);
  const changed = state.sort !== "value" || state.perLiter || state.pack !== "all";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {leading}
      {/* Keyed by the choice, so it closes once one is made (a client navigation would keep it open). */}
      <details key={`${state.sort}|${state.perLiter}|${state.pack}`} className="sort-panel group w-full [&:not([open])]:w-auto">
        <summary
          className={`inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-full border px-4 text-sm font-semibold [&::-webkit-details-marker]:hidden ${
            changed ? "border-on-ground text-on-ground" : "border-ground-line text-on-ground-2"
          }`}
        >
          <span>{sorting ? "מיון" : "סינון"}:</span>
          <span className="text-on-ground">{summary.join(" · ") || "הכל"}</span>
          <ChevronDownIcon size={16} className="transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-3 space-y-2">
      {sorting && (
        <ChipRow label="מיון">
          <Chip href={href({ sort: "value" })} selected={state.sort === "value"}>
            {SORT_LABEL.value}
            <span className="sr-only">: הנחה גבוהה קודם</span>
          </Chip>
          <Chip href={href({ sort: "price_asc" })} selected={state.sort === "price_asc"}>
            {SORT_LABEL.price_asc}
            <ArrowUpIcon size={16} />
            <span className="sr-only">מהזול ליקר</span>
          </Chip>
          <Chip href={href({ sort: "price_desc" })} selected={state.sort === "price_desc"}>
            {SORT_LABEL.price_desc}
            <ArrowDownIcon size={16} />
            <span className="sr-only">מהיקר לזול</span>
          </Chip>
          <Chip href={href({ unit: state.perLiter ? "" : "1" })} selected={state.perLiter}>
            לליטר
            <span className="sr-only">: השוואה לפי מחיר לליטר</span>
          </Chip>
        </ChipRow>
      )}

      {packs && (
        <ChipRow label="סינון">
          {packs &&
            (["all", "single", "multi", "case"] as PackFilter[])
            .filter((pack) => pack === "all" || pack === state.pack || !availablePacks || availablePacks.includes(pack))
            .map((pack) => (
              <Chip key={pack} href={href({ pack })} selected={state.pack === pack}>
                {PACK_LABEL[pack]}
              </Chip>
            ))}
        </ChipRow>
      )}
        </div>
      </details>
    </div>
  );
}
