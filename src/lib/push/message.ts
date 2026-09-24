import { CATEGORY_LABEL_ONE, type DealCategory } from "@/lib/categories";
import { formatAgorot } from "@/lib/money";

/**
 * The notification text. Pure, so it can be read and tested without a database
 * or a push service.
 *
 * The name is optional because an anonymous user who skipped onboarding has no
 * name — and a notification that opens "undefined 🍺" is worse than one that
 * opens with the beer.
 */
export function buildDealNotification(input: {
  firstName: string | null;
  beerName: string;
  category: DealCategory;
  dealPriceAgorot: number;
  storeName: string;
  discountPercent: number;
}): { title: string; body: string } {
  const greeting = input.firstName ? `${input.firstName} 🍺` : "🍺";
  const price = formatAgorot(input.dealPriceAgorot);
  const unit = CATEGORY_LABEL_ONE[input.category];

  return {
    title: `${greeting} מבצע על ${input.beerName}`,
    body: `${unit} ב־${price} ₪ ב${input.storeName} — ${input.discountPercent}% הנחה.`,
  };
}
