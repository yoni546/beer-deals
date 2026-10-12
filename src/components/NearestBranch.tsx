import { PinIcon } from "@/components/ui/icons";
import type { NearbyBranch } from "@/lib/distance";

/**
 * Which shop the distance is to, and a tap that gets you there.
 *
 * "הכי קרוב אליי" said "12 ק״מ ממך" and nothing else. A distance with no place
 * attached is a number: the person still has to work out which branch it meant, and
 * then type it into a navigation app from memory. This names the branch, its town and
 * the street the publisher gave us, and makes the whole thing a link to Waze.
 *
 * WHY IT HANDS WAZE TEXT AND NOT A POINT. Because the point is the TOWN CENTRE
 * (geocode_precision = 'locality', migration 0045) and we say so on the screen. Giving
 * a navigation app a coordinate we know is not the shop would be the one lie this
 * feature was built to refuse — it would route somebody confidently to a roundabout.
 * The address is text from the publisher's own Stores file; Waze resolves it itself,
 * and gets the door right far more often than our centroid would.
 *
 * With no address at all it still searches by the chain, the branch and the town,
 * which is what a person would have typed anyway.
 */
export function NearestBranch({ place, storeName }: { place: NearbyBranch; storeName: string }) {
  const where = [place.address, place.city].filter(Boolean).join(", ");
  const label = [place.branchName, where].filter(Boolean).join(" · ");
  if (!label) return null;

  // Waze's universal link. `q` is a search, not a coordinate, for the reason above.
  const query = [storeName, place.branchName, place.address, place.city].filter(Boolean).join(" ");
  const href = `https://waze.com/ul?q=${encodeURIComponent(query)}&navigate=yes`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center gap-1.5 font-medium text-ink underline-offset-4 hover:underline"
    >
      <PinIcon />
      <span>{label}</span>
      <span className="sr-only">— פתיחה בוויז</span>
    </a>
  );
}
