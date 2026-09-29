/**
 * The two parts of a beer or chain page — current deals, then regular prices — each with a heading,
 * and a pair of jump links at the top so the second part is one tap away on a long page.
 */
export function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-3 text-xl leading-tight font-bold text-on-ground">
      {children}
    </h2>
  );
}

export function SectionJump({ items }: { items: { href: string; label: string }[] }) {
  return (
    <nav aria-label="חלקי העמוד" className="flex rounded-2xl border border-ground-line p-1">
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          className="flex min-h-11 flex-1 items-center justify-center rounded-xl px-3 text-sm font-semibold text-on-ground-2 hover:bg-paper hover:text-ink"
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
