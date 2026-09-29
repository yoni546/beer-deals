import { ArrowDownIcon } from "@/components/ui/icons";

/**
 * The two parts of a beer or chain page — current deals, then regular prices — each with a heading.
 * The deals are already at the top, so the only jump needed is a quiet link down to the regular prices.
 */
export function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-3 text-xl leading-tight font-bold text-on-ground">
      {children}
    </h2>
  );
}

export function JumpToRegular({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <a href="#regular" className="inline-flex min-h-11 items-center gap-1 px-1 text-sm font-semibold text-on-ground-2 underline-offset-4 hover:text-on-ground hover:underline">
      מחירים רגילים ({count})
      <ArrowDownIcon size={16} />
    </a>
  );
}
