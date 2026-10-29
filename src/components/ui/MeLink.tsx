import Link from "next/link";
import { MeIcon } from "@/components/ui/icons";

/**
 * The way to the person's own settings ("אני"): a corner of each main screen's heading, not a tab.
 * Settings are visited rarely — the four beers are chosen once, notifications once — so they
 * do not earn a place on the bar that the map now has (owner, 2026-10-29). A corner rather than a
 * drawer: the settings screen is a page of forms, and a drawer would only hide it behind one more
 * motion on the way in. The one motion here answers the tap (a press), and it is off with the rest
 * of the app's motion under reduced motion.
 */
export function MeLink() {
  return (
    <Link
      href="/settings"
      // Same reason as the tab bar: a prefetch of a force-dynamic route is a wasted round trip.
      prefetch={false}
      aria-label="אני"
      className="me-link -me-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-ground-line bg-ground-2 text-on-ground"
    >
      <MeIcon />
    </Link>
  );
}
