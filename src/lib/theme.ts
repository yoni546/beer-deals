import type { Beer } from "@/lib/db/types";

/**
 * The Primary Beer sets four CSS variables and nothing else.
 *
 * Deliberately not a set of per-beer stylesheets: the spec requires the
 * application structure to stay identical whatever the theme, and the surest
 * way to guarantee that is for the theme to be unable to express structure.
 * Four colours cannot move a button.
 */
export type ThemeVars = {
  "--base": string;
  "--surface": string;
  "--accent": string;
  "--ink": string;
};

/** Amber lager — the look before anyone has chosen a beer. */
export const DEFAULT_THEME: ThemeVars = {
  "--base": "#17130b",
  "--surface": "#231d12",
  "--accent": "#e0a52b",
  "--ink": "#faf6ee",
};

export function themeFor(beer: Beer | null | undefined): ThemeVars {
  if (!beer) return DEFAULT_THEME;
  return {
    "--base": beer.theme_base,
    "--surface": beer.theme_surface,
    "--accent": beer.theme_accent,
    "--ink": beer.theme_ink,
  };
}

/** For the browser chrome / status bar, so the PWA does not frame itself in white. */
export function themeColor(beer: Beer | null | undefined): string {
  return beer?.theme_base ?? DEFAULT_THEME["--base"];
}
