import { PACK_CLASS_HE } from "@/lib/format";
import type { PackClass } from "@/lib/offer-logic";

/**
 * A beer's or a chain's page, in the order someone buying beer for home looks (PRODUCT.md):
 *
 *   שישיות        deals everyone can use, then the regular shelf prices
 *   ארגזים        deals, then regular prices
 *   בודדים        deals, then regular prices
 *
 * A kind with nothing in it is left out. Inside a kind, a deal is never mixed with a regular price.
 */
export function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-3 text-xl leading-tight font-bold text-on-ground">
      {children}
    </h2>
  );
}

export function CategorySection({ kind, aside, children }: { kind: PackClass; aside?: React.ReactNode; children: React.ReactNode }) {
  const id = `pack-${kind}`;
  return (
    <section aria-labelledby={id} data-pack-section={kind} className="scroll-mt-4">
      <div className="flex items-baseline justify-between gap-3">
        <SectionHeading id={id}>{PACK_CLASS_HE[kind]}</SectionHeading>
        {aside && <span className="text-sm text-on-ground-2">{aside}</span>}
      </div>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

/** "מבצעים" / "מחירים רגילים" / "בחנויות משקאות" inside a kind: which of them a list is. */
export function Part({ title, children, part }: { title: string; part: "deals" | "regular" | "shops"; children: React.ReactNode }) {
  return (
    <div data-part={part}>
      <h3 className="mb-2 text-sm font-semibold text-on-ground-2">{title}</h3>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

/** A kind with regular prices but no deal right now: said in one quiet line, not a whole empty card. */
export function NoDealLine({ children }: { children: React.ReactNode }) {
  return (
    <p data-part="deals" className="text-sm text-on-ground-2">
      {children}
    </p>
  );
}
