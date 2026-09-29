import { Chip, ChipRow } from "@/components/ui/Chip";
import { ChevronDownIcon } from "@/components/ui/icons";
import { PACK_CLASS_HE } from "@/lib/format";
import { PACK_FILTERS, type PackFilter, type SortMode } from "@/lib/offer-logic";
import { withParams } from "@/lib/urls";

export type ViewState = {
  sort: SortMode;
  perLiter: boolean;
  pack: PackFilter;
  /** Any other parameters to carry along untouched (view, mine, …). */
  extra?: Record<string, string | undefined>;
};

const DEFAULTS = { sort: "value", unit: "", pack: "all" };

/** The three categories a person sees (src/lib/offer-logic.ts, PackClass) — never "מארזים". */
const PACK_LABEL: Record<PackFilter, string> = { all: "הכל", ...PACK_CLASS_HE };
const SORT_LABEL: Record<SortMode, string> = { value: "הכי משתלם", price_asc: "מהזול ליקר", price_desc: "מהיקר לזול" };

/**
 * Sort and filter, folded into ONE quiet control that says what is active ("מיון: הכי משתלם ·
 * שישיות"); the options open under it. Everything is a link to "this page with one thing changed"
 * (src/lib/urls.ts), so state is in the URL and it works with no script at all (native <details>).
 * A page's own primary toggle (the store page's "my beers") stays outside, in plain view.
 *
 *   הכי משתלם | מהזול ליקר | מהיקר לזול | לליטר     how to order
 *   הכל | שישיות | ארגזים | בודדים                  which packs (Home has no singles)
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
    sorting ? SORT_LABEL[state.sort] : null,
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
          </Chip>
          <Chip href={href({ sort: "price_asc" })} selected={state.sort === "price_asc"}>
            {SORT_LABEL.price_asc}
          </Chip>
          <Chip href={href({ sort: "price_desc" })} selected={state.sort === "price_desc"}>
            {SORT_LABEL.price_desc}
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
            PACK_FILTERS.filter((pack) => pack === "all" || pack === state.pack || !availablePacks || availablePacks.includes(pack))
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
