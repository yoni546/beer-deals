import { formatPrice } from "@/lib/money";

const SIZE = {
  sm: "text-[1.25rem] font-semibold",
  md: "text-[1.75rem] font-bold",
  lg: "text-[2.75rem] font-bold",
} as const;

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
    <span className={`num leading-none tracking-tight ${SIZE[size]} ${className}`}>
      <span className="sr-only">{formatPrice(agorot)}</span>
      <span aria-hidden className="inline-flex items-start">
        <span className="me-[0.08em] mt-[0.12em] text-[0.5em] font-semibold">₪</span>
        <span>{shekels}</span>
        <span className="ms-[0.06em] mt-[0.06em] text-[0.5em] font-semibold">{rest}</span>
      </span>
    </span>
  );
}

/**
 * A verified saving: "−36%". The figure is isolated left-to-right so the minus stays on
 * the left of the number instead of trailing it in a right-to-left line ("36%-").
 * Callers only render it when the database supplied a verified value_pct.
 */
export function Saving({ pct, className = "" }: { pct: number; className?: string }) {
  return (
    <span className={className}>
      <span className="sr-only">חיסכון של {pct} אחוז</span>
      <span aria-hidden className="num">
        −{pct}%
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
