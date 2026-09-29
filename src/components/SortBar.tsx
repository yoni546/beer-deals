import { Chip, ChipRow } from "@/components/ui/Chip";
import { ArrowDownIcon, ArrowUpIcon } from "@/components/ui/icons";
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

/**
 * Sort and filter, as chips. Everything is a link to "this page with one thing changed"
 * (src/lib/urls.ts), so state is in the URL and works with no script at all.
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

  return (
    <div className="space-y-2">
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

      {(packs || leading) && (
        <ChipRow label="סינון">
          {leading}
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
  );
}
