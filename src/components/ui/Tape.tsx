import type { ReactNode } from "react";

/**
 * A strip of paper on the counter. Content on it is dark ink on near-white and is
 * never lower than 4.5:1 in any theme (tests/design.test.ts). The zig-zag top and
 * bottom are the receipt's perforation. Use `flat` to drop them where a strip
 * continues into another (a form under its heading, for instance).
 */
export function Tape({
  children,
  className = "",
  flat = false,
  printIn = false,
  as: Tag = "section",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  flat?: boolean;
  printIn?: boolean;
  as?: "section" | "div" | "article" | "ul" | "ol" | "form" | "nav";
} & React.HTMLAttributes<HTMLElement>) {
  const Element = Tag as React.ElementType;
  return (
    <Element className={`tape ${flat ? "tape-flat" : ""} ${printIn ? "print-in" : ""} ${className}`} {...rest}>
      {children}
    </Element>
  );
}

/** A heading printed at the top of a strip. */
export function TapeHeading({
  children,
  aside,
  as: Tag = "h2",
  className = "",
}: {
  children: ReactNode;
  aside?: ReactNode;
  as?: "h1" | "h2" | "h3";
  className?: string;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 px-4 pt-4 pb-2 ${className}`}>
      <Tag className="text-base font-bold text-ink">{children}</Tag>
      {aside && <span className="shrink-0 text-xs text-ink-2">{aside}</span>}
    </div>
  );
}

/** Blank space between strips, with the counter showing through. */
export function Gap({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return <div aria-hidden className={{ sm: "h-4", md: "h-7", lg: "h-10" }[size]} />;
}
