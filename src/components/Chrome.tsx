import Link from "next/link";
import type { ReactNode } from "react";
import { AlertIcon, ChevronRightIcon, InfoIcon } from "@/components/ui/icons";
import { Tape } from "@/components/ui/Tape";

/**
 * The page shell: one phone-width column centred on the counter at any size, with
 * room at the foot for the tab bar. `bare` is for full-viewport flows (onboarding).
 */
export function Screen({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  return (
    <main
      className={`mx-auto w-full max-w-[30rem] px-5 pt-5 ${
        bare ? "pb-10" : "pb-[calc(6.5rem+env(safe-area-inset-bottom))]"
      }`}
    >
      {children}
    </main>
  );
}

/** A title on the counter, with a back arrow (which points right in a right-to-left page). */
export function TopBar({
  title,
  backHref,
  action,
  sub,
}: {
  title: string;
  backHref?: string;
  action?: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <header className="mb-5">
      <div className="flex items-center gap-2">
        {backHref && (
          <Link
            href={backHref}
            aria-label="חזרה"
            className="-ms-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-on-ground hover:bg-ground-2"
          >
            <ChevronRightIcon />
          </Link>
        )}
        <h1 className="min-w-0 flex-1 truncate text-[1.75rem] leading-tight font-bold text-on-ground">{title}</h1>
        {action}
      </div>
      {sub && <p className="mt-1 text-sm text-on-ground-2">{sub}</p>}
    </header>
  );
}

/** Nothing to show: blank paper, one dotted line, and — when there is one — the next step. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Tape className="px-5 py-8 text-center">
      {title && <p className="text-base font-bold text-ink">{title}</p>}
      <div aria-hidden className="mx-auto my-3 w-16 border-t-2 border-dotted border-paper-line" />
      {children && <div className="text-sm leading-relaxed text-ink-2">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </Tape>
  );
}

/** A primary action on the counter or on paper. */
export function ButtonLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "quiet";
}) {
  return (
    <Link href={href} className={`btn ${variant === "primary" ? "" : "btn-quiet"}`}>
      {children}
    </Link>
  );
}

/**
 * A message that must be read: an error, or a confirmation. It is a piece of paper with
 * words on it — never colour alone — so it reads the same in every theme and appearance.
 * Errors are announced (role="alert"); confirmations politely (role="status").
 */
export function Notice({ children, tone = "error" }: { children: ReactNode; tone?: "error" | "info" }) {
  const Icon = tone === "error" ? AlertIcon : InfoIcon;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-2.5 rounded-xl bg-paper px-3.5 py-3 text-sm leading-relaxed text-ink ${
        tone === "error" ? "border-2 border-danger" : "border border-paper-line"
      }`}
    >
      <span aria-hidden className={`mt-0.5 shrink-0 ${tone === "error" ? "text-danger" : "text-ink-2"}`}>
        <Icon size={18} />
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}
