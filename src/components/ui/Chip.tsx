import Link from "next/link";
import type { ReactNode } from "react";

const BASE =
  "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors";
const ON = "border-transparent bg-paper text-ink";
const OFF = "border-ground-line bg-transparent text-on-ground-2 hover:text-on-ground";

/**
 * A filter or sort control that lives on the counter. Selected = a piece of paper
 * (ink on near-white); unselected = an outline. Being a link, the choice is in the
 * URL: it survives a refresh, can be shared, and the back button does what people
 * expect. Never colour alone: the selected chip also carries aria-current.
 */
export function Chip({
  href,
  selected = false,
  children,
  replace = true,
}: {
  href: string;
  selected?: boolean;
  children: ReactNode;
  replace?: boolean;
}) {
  return (
    <Link href={href} prefetch={false} replace={replace} scroll={false} aria-current={selected ? "true" : undefined} className={`${BASE} ${selected ? ON : OFF}`}>
      {children}
    </Link>
  );
}

/** A row of chips that scrolls sideways on a narrow screen instead of wrapping into a wall. */
export function ChipRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <nav aria-label={label} className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {children}
    </nav>
  );
}

/** Two or three mutually exclusive views ("promotions | regular prices"). */
export function Segmented({
  items,
  label,
}: {
  items: { href: string; label: string; selected: boolean }[];
  label: string;
}) {
  return (
    <nav aria-label={label} className="flex rounded-2xl border border-ground-line p-1">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          replace
          scroll={false}
          aria-current={item.selected ? "page" : undefined}
          className={`flex min-h-11 flex-1 items-center justify-center rounded-xl px-3 text-sm font-semibold transition-colors ${
            item.selected ? "bg-paper text-ink" : "text-on-ground-2 hover:text-on-ground"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
