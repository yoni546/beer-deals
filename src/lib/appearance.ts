/**
 * Light, dark, or whatever the phone says.
 *
 * DESIGN.md said for a long time that the phone decides and there is no in-app switch, and
 * a picker that had existed before was removed (0011 left its column behind). The
 * owner asked for the choice back on 2026-11-14, so the rule changed in writing and here
 * together; what did NOT change is that colour still comes from favourite #1. This picks
 * which of that beer's two generated modes is shown, and nothing else.
 *
 * WHY A COOKIE, AND NOT localStorage. Every page is rendered on the server, so the server
 * has to know the answer before it writes the stylesheet. Read from localStorage instead
 * and the first paint is the wrong mode, corrected a moment later -- the white flash that
 * makes an app feel broken in a dark room. A cookie arrives with the request.
 *
 * It holds no personal data: one of three fixed words, and no account is needed to have one.
 */
// Nothing in this file may touch next/headers. <AppearanceChoice> is a Client Component and
// imports the labels from here; one `cookies()` import at the top made the whole module
// server-only and the build failed with "that only works in a Server Component". Reading the
// cookie lives in appearance.server.ts.
export const APPEARANCE_COOKIE = "appearance";

export const APPEARANCES = ["system", "light", "dark"] as const;
export type Appearance = (typeof APPEARANCES)[number];

export const APPEARANCE_LABEL_HE: Record<Appearance, string> = {
  system: "לפי הטלפון",
  light: "בהיר",
  dark: "כהה",
};

/** Anything unrecognised is "system": a stale or hand-edited cookie must not blank the screen. */
export function parseAppearance(value: string | undefined | null): Appearance {
  return (APPEARANCES as readonly string[]).includes(value ?? "") ? (value as Appearance) : "system";
}
