"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const BASE =
  "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors";
const ON = "border-transparent bg-paper text-ink";
const OFF = "border-ground-line bg-transparent text-on-ground-2 hover:text-on-ground";

/**
 * The admin panel's section switcher. It takes plain data (the layout decides which
 * tabs a viewer may see) and only adds "you are here": the current tab is a piece of
 * paper, the others are outlines, and the current one also carries aria-current so
 * the state is never colour alone.
 */
export function AdminNav({ tabs }: { tabs: { href: string; label: string }[] }) {
  const pathname = usePathname() ?? "";

  return (
    <nav aria-label="ניהול" className="mb-6 flex flex-wrap gap-2">
      {tabs.map((tab) => {
        const current = tab.href === "/admin" ? pathname === "/admin" : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link key={tab.href} href={tab.href} aria-current={current ? "page" : undefined} className={`${BASE} ${current ? ON : OFF}`}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
