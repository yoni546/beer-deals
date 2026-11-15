"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { APPEARANCE_COOKIE, parseAppearance } from "@/lib/appearance";

/**
 * Remember whether this browser wants light, dark, or whatever the phone says.
 *
 * Not a profile column, on purpose. The choice belongs to the device a person is
 * holding -- the same account on a phone at night and a laptop at noon can reasonably
 * want different answers -- and a cookie needs no account at all, so it works on the
 * first visit, before onboarding, which is where someone squinting at a bright screen
 * is most likely to go looking for it.
 *
 * Whatever arrives is parsed back to one of three fixed words; nothing else is stored.
 */
export async function setAppearance(value: string): Promise<void> {
  const appearance = parseAppearance(value);
  const store = await cookies();

  store.set(APPEARANCE_COOKIE, appearance, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    // Readable by the client on purpose: no secret, and a future client-side control
    // should be able to see what is already chosen without a round trip.
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
  });

  // The stylesheet is written in the root layout, so every rendered page carries the old
  // mode until it is rebuilt.
  revalidatePath("/", "layout");
}
