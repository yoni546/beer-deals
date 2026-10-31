import { formatPrice } from "@/lib/money";

const SIZE = { sm: "price-sm", md: "price-md", lg: "price-lg" } as const;

/**
 * A price as it is printed on a shelf label: a large shekel figure with the agorot
 * raised beside it (₪24⁹⁰). The whole amount is also present, as text, for screen
 * readers and for anyone copying the page — the raised digits are decoration only.
 */
export function Price({
  agorot,
  size = "md",
  className = "",
}: {
  agorot: number;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const shekels = Math.floor(agorot / 100);
  const rest = String(agorot % 100).padStart(2, "0");

  return (
    <span className={`num price ${SIZE[size]} ${className}`}>
      <span className="sr-only">{formatPrice(agorot)}</span>
      <span aria-hidden className="price-stack">
        <span className="price-sign">₪</span>
        <span>{shekels}</span>
        <span className="price-agorot">{rest}</span>
      </span>
    </span>
  );
}

/**
 * A verified saving: "−36%". The figure is isolated left-to-right so the minus stays on
 * the left of the number instead of trailing it in a right-to-left line ("36%-").
 * Callers only render it when the database supplied a verified value_pct.
 */
export function Saving({ pct, upTo = false, className = "" }: { pct: number; upTo?: boolean; className?: string }) {
  // `upTo`: the best of several deals, not every one of them ("עד −58%").
  return (
    <span className={className}>
      <span className="sr-only">
        חיסכון של {upTo ? "עד " : ""}
        {pct} אחוז
      </span>
      <span aria-hidden>
        {upTo && "עד "}
        <span className="num">−{pct}%</span>
      </span>
    </span>
  );
}

/** Price per litre, the comparable number across pack sizes: "₪12.63 לליטר". */
export function UnitPrice({ agorotPerLiter, className = "" }: { agorotPerLiter: number; className?: string }) {
  return (
    <span className={className}>
      <span className="num">{formatPrice(agorotPerLiter)}</span> לליטר
    </span>
  );
}
