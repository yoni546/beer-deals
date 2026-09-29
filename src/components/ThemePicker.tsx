"use client";

import { useState, useTransition } from "react";
import { Notice } from "@/components/Chrome";
import { Tape } from "@/components/ui/Tape";
import { ALL_THEMES, resolveTheme, swatches, themeStyleSheet, type Appearance } from "@/design/themes";
import { saveAppearance } from "@/lib/actions/appearance";

const APPEARANCE_LABEL: Record<Appearance, string> = { system: "לפי המכשיר", light: "בהיר", dark: "כהה" };

/**
 * Settings → מראה. The look follows favourite #1 unless it is overridden here; light/dark
 * follows the device unless it is overridden here.
 *
 * A choice is painted at once (the same stylesheet the server would send), then saved. If
 * saving fails the previous look comes back and the reason is shown, so the screen never
 * claims a setting that did not stick. Everything is a real button with a text label:
 * the swatches are a preview, not the only way to tell the choices apart.
 */
export function ThemePicker({
  override,
  appearance,
  primarySlug,
  primaryName,
  beerNames,
}: {
  override: string | null;
  appearance: Appearance;
  primarySlug: string | null;
  primaryName: string | null;
  /** Beer slug → Hebrew name, so a look can be recognised by the beer it belongs to. */
  beerNames: Record<string, string>;
}) {
  const [theme, setTheme] = useState<string | null>(override);
  const [mode, setMode] = useState<Appearance>(appearance);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const active = resolveTheme({ override: theme, primaryBeerSlug: primarySlug });

  function paint(nextTheme: string | null, nextMode: Appearance) {
    const style = document.getElementById("theme");
    if (style) style.textContent = themeStyleSheet(resolveTheme({ override: nextTheme, primaryBeerSlug: primarySlug }), nextMode);
  }

  function choose(change: { theme?: string | null; appearance?: Appearance }) {
    const before = { theme, mode };
    const nextTheme = change.theme !== undefined ? change.theme : theme;
    const nextMode = change.appearance ?? mode;
    setError(null);
    setTheme(nextTheme);
    setMode(nextMode);
    paint(nextTheme, nextMode);

    startTransition(async () => {
      const result = await saveAppearance({
        ...(change.theme !== undefined ? { theme: change.theme ?? "auto" } : {}),
        ...(change.appearance ? { appearance: change.appearance } : {}),
      });
      if (!result.ok) {
        setTheme(before.theme);
        setMode(before.mode);
        paint(before.theme, before.mode);
        setError(result.error);
      }
    });
  }

  return (
    <Tape className="px-4 py-4">
      <fieldset>
        <legend className="mb-2 text-base font-bold text-ink">בהיר או כהה</legend>
        <div className="flex rounded-2xl border border-paper-line p-1">
          {(Object.keys(APPEARANCE_LABEL) as Appearance[]).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => choose({ appearance: value })}
              className={`flex min-h-11 flex-1 items-center justify-center rounded-xl px-2 text-sm font-semibold ${
                mode === value ? "bg-ink text-paper" : "text-ink-2"
              }`}
            >
              {APPEARANCE_LABEL[value]}
            </button>
          ))}
        </div>
      </fieldset>

      <div aria-hidden className="tear my-4" />

      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 marker:hidden [&::-webkit-details-marker]:hidden">
          <Swatch slug={active.slug} mode={mode} />
          <span className="min-w-0 flex-1">
            <span className="block text-base font-bold text-ink">צבעי האפליקציה</span>
            <span className="block text-sm text-ink-2">
              {theme === null
                ? `אוטומטי${primaryName ? `, לפי ${primaryName}` : ""}`
                : `נבחר ידנית: ${active.name_he}${beerNames[active.slug] ? ` (${beerNames[active.slug]})` : ""}`}
            </span>
          </span>
          <span className="text-sm font-semibold text-ink underline underline-offset-4 group-open:hidden">לבחירה</span>
          <span className="hidden text-sm font-semibold text-ink underline underline-offset-4 group-open:inline">סגירה</span>
        </summary>

        <ul className="mt-3 grid grid-cols-4 gap-2">
          <li>
            <ThemeTile
              label="אוטומטי"
              selected={theme === null}
              onSelect={() => choose({ theme: null })}
              slug={resolveTheme({ primaryBeerSlug: primarySlug }).slug}
              mode={mode}
            />
          </li>
          {ALL_THEMES.map((mood) => (
            <li key={mood.slug}>
              <ThemeTile label={mood.name_he} beer={beerNames[mood.slug]} selected={theme === mood.slug} onSelect={() => choose({ theme: mood.slug })} slug={mood.slug} mode={mode} />
            </li>
          ))}
        </ul>
      </details>

      {error && (
        <div className="pt-3">
          <Notice>{error}</Notice>
        </div>
      )}
    </Tape>
  );
}

function ThemeTile({ label, beer, selected, onSelect, slug, mode }: { label: string; beer?: string; selected: boolean; onSelect: () => void; slug: string; mode: Appearance }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex min-h-[5.5rem] w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-1 py-2 ${
        selected ? "border-ink" : "border-transparent"
      }`}
    >
      <Swatch slug={slug} mode={mode} />
      <span className="line-clamp-2 text-center text-xs leading-tight font-semibold text-ink">{label}</span>
      {beer && <span className="line-clamp-1 text-center text-xs leading-tight text-ink-2">{beer}</span>}
    </button>
  );
}

/** Three stripes — counter, accent, paper — in the mode that is (or, on "system", will be) showing. */
function Swatch({ slug, mode }: { slug: string; mode: Appearance }) {
  const mood = ALL_THEMES.find((theme) => theme.slug === slug) ?? ALL_THEMES[0];
  const stripes = (which: "light" | "dark") => {
    const colours = swatches(mood, which);
    return (
      <>
        <span className="h-7 w-4" style={{ background: colours.ground }} />
        <span className="h-7 w-3" style={{ background: colours.accent }} />
        <span className="h-7 w-3" style={{ background: colours.paper }} />
      </>
    );
  };
  return (
    <span aria-hidden className="flex shrink-0 overflow-hidden rounded-lg ring-1 ring-paper-line">
      {mode === "system" ? (
        <>
          <span className="flex dark:hidden">{stripes("light")}</span>
          <span className="hidden dark:flex">{stripes("dark")}</span>
        </>
      ) : (
        <span className="flex">{stripes(mode)}</span>
      )}
    </span>
  );
}
