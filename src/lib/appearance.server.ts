import { cookies } from "next/headers";
import { APPEARANCE_COOKIE, parseAppearance, type Appearance } from "@/lib/appearance";

/**
 * The light/dark choice this browser sent, for a Server Component.
 *
 * Apart from `next/headers`, this would sit in appearance.ts — and it did, until
 * <AppearanceChoice> imported the labels from there and dragged `cookies()` into a
 * Client Component, which does not build. Kept in its own file so the import itself
 * says which side of the line a caller is on.
 */
export async function currentAppearance(): Promise<Appearance> {
  return parseAppearance((await cookies()).get(APPEARANCE_COOKIE)?.value);
}
