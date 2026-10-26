"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GlassIcon, MeIcon, StoreIcon, TagIcon } from "@/components/ui/icons";

const TABS = [
  { href: "/", label: "מבצעים", Icon: TagIcon, match: (p: string) => p === "/" },
  { href: "/beer", label: "בירות", Icon: GlassIcon, match: (p: string) => p.startsWith("/beer") },
  { href: "/store", label: "סופרים", Icon: StoreIcon, match: (p: string) => p.startsWith("/store") },
  { href: "/settings", label: "אני", Icon: MeIcon, match: (p: string) => p.startsWith("/settings") || p.startsWith("/whats-new") || p.startsWith("/submit") },
] as const;

/** Screens that own the whole viewport: onboarding and the admin tools. */
const HIDDEN_ON = ["/welcome", "/admin"];

/**
 * The counter's edge: four places, always one tap away. Solid, not glass; every
 * target is at least 64px tall. The current place is marked twice (a bar and the
 * bold label) so it never depends on colour.
 */
export function TabBar() {
  const pathname = usePathname() ?? "/";
  if (HIDDEN_ON.some((prefix) => pathname.startsWith(prefix))) return null;

  return (
    <nav
      aria-label="ניווט ראשי"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-ground-line bg-ground-2 pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-[30rem]">
        {TABS.map(({ href, label, Icon, match }) => {
          const current = match(pathname);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                // Every tab points at a force-dynamic route, and this bar is in the root
                // layout, so default prefetching turned one page view into up to four
                // server renders -- three of which nobody asked for, each paying the full
                // Israel-Tokyo round trip, and each queued ahead of the person's own tap.
                //
                // RETRIED 2026-10-26 AND PUT BACK. Navigation costs ~850 ms from Israel, of
                // which ~600 ms is the fra1->hnd1 hop every page pays whatever it renders, so
                // prefetching four links looked like a way to spend that second while
                // somebody reads instead of after they tap. It is not: a prefetch of a
                // force-dynamic route is answered with 159 bytes containing no page at all
                // (a real navigation to /beer is 14,591), because Next will not render a
                // force-dynamic route for a prefetch. The request is pure waste and the tap
                // still pays in full -- measured, not guessed. docs/LESSONS.md has the
                // transcript. Nothing here can be fixed in code; the hop itself is the bug.
                prefetch={false}
                aria-current={current ? "page" : undefined}
                className={`relative flex h-16 flex-col items-center justify-center gap-1 text-xs ${
                  current ? "font-bold text-on-ground" : "font-medium text-on-ground-2"
                }`}
              >
                {current && <span aria-hidden className="absolute top-0 h-[3px] w-10 rounded-b-full bg-accent" />}
                <span className={current ? "text-accent" : ""}>
                  <Icon />
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
