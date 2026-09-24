import Link from "next/link";

/** The page shell: one column, phone width, centred on anything larger. */
export function Screen({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-md px-5 pt-6 pb-12">{children}</main>
  );
}

/** A back arrow and a title. Every screen but home has one. */
export function TopBar({
  title,
  backHref = "/",
  action,
}: {
  title: string;
  backHref?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-5 flex items-center gap-3">
      <Link
        href={backHref}
        aria-label="חזרה"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--surface)] text-lg ring-1 ring-white/10"
      >
        {/* RTL: "back" points right. */}
        <span aria-hidden>›</span>
      </Link>
      <h1 className="min-w-0 flex-1 truncate text-xl font-black">{title}</h1>
      {action}
    </header>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl bg-[color:var(--surface)]/60 px-4 py-8 text-center text-sm opacity-55 ring-1 ring-white/5">
      {children}
    </p>
  );
}
