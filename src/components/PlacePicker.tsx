"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { PinIcon } from "@/components/ui/icons";
import { kmBetween, nearestCity, radiusLabel, RADIUS_CHOICES, searchCities, type City } from "@/lib/cities";

/**
 * Where a person lives, and how far they will go for a deal.
 *
 * Two deliberate limits, both from the V2 brief:
 *
 *  - It asks for a SETTLEMENT, never a street address. A town centre is all a
 *    radius needs, and it is the least we can ask for to do the job.
 *  - Precise location is only ever requested after an explicit tap. The browser
 *    prompt never appears because a screen loaded.
 *
 * It also has to work for somebody whose village is not in the list: the city
 * they typed is saved as text with no coordinates, which is a real answer — we
 * simply cannot measure distances for them yet, and the app says so elsewhere
 * rather than pretending.
 *
 * The values ride in hidden inputs so the surrounding <form> carries them, which
 * is what lets onboarding save the beers and the place in one submit.
 */

export type Place = {
  city: string;
  lat: number | null;
  lon: number | null;
  radiusKm: number | null;
};

export const EMPTY_PLACE: Place = { city: "", lat: null, lon: null, radiusKm: null };

type Geo = "idle" | "asking" | "denied" | "unavailable";

export function PlacePicker({
  value,
  onChange,
  headingId,
}: {
  value: Place;
  onChange: (next: Place) => void;
  headingId?: string;
}) {
  const [query, setQuery] = useState(value.city);
  const [open, setOpen] = useState(false);
  const [geo, setGeo] = useState<Geo>("idle");
  const inputId = useId();
  const listId = useId();
  const radiusRef = useRef<HTMLDivElement | null>(null);

  /**
   * The place as it is RIGHT NOW, for the two paths that run after their render has
   * been replaced: the blur below (deliberately delayed, so a click on a suggestion
   * lands first) and the geolocation callback.
   *
   * Without this they spread a stale `value`, and the bug that cost a real
   * afternoon was exactly that: choose a town, tap a distance, and 120 ms later the
   * pending blur wrote the town back on top of the place as it was BEFORE the
   * distance -- silently resetting it. The e2e caught it as a flake; it is not one.
   */
  const latest = useRef(value);
  latest.current = value;

  const matches = useMemo(() => (open ? searchCities(query) : []), [open, query]);
  const chosen = Boolean(value.city);

  // Once a place is known, bring the distance question into view rather than
  // leaving it below the fold on a short phone.
  useEffect(() => {
    if (chosen) radiusRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [chosen]);

  function choose(place: City) {
    setQuery(place.name);
    setOpen(false);
    onChange({ ...latest.current, city: place.name, lat: place.lat, lon: place.lon });
  }

  /** The typed text, kept as-is when it matches nothing we hold. */
  function keepTyped() {
    setOpen(false);
    const current = latest.current;
    const text = query.trim();
    // Nothing was typed since the place was settled -- which is the common case when
    // this runs from a delayed blur. Writing anything here could only undo something.
    if (text === current.city) return;
    if (!text) return onChange({ ...current, city: "", lat: null, lon: null });
    const exact = searchCities(text)[0];
    if (exact && exact.name === text) return choose(exact);
    onChange({ ...current, city: text, lat: null, lon: null });
  }

  function useMyLocation() {
    if (!("geolocation" in navigator)) return setGeo("unavailable");
    setGeo("asking");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const near = nearestCity(coords.latitude, coords.longitude);
        setGeo("idle");
        // The browser's own point is the better one to measure from; the town is
        // only how we say it back to them.
        setQuery(near?.name ?? "");
        onChange({
          ...latest.current,
          city: near?.name ?? "",
          lat: Number(coords.latitude.toFixed(4)),
          lon: Number(coords.longitude.toFixed(4)),
        });
      },
      (error) => setGeo(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }

  const far = value.lat !== null && value.city ? nearestCity(value.lat, value.lon!, 200) : null;
  const offBy = far && far.name !== value.city ? Math.round(kmBetween(value.lat!, value.lon!, far.lat, far.lon)) : null;

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={inputId} className="mb-1.5 block text-base font-bold text-on-ground">
          איפה אתם גרים?
        </label>
        <p className="mb-2 text-sm text-on-ground-2">רק היישוב. לא צריך כתובת.</p>

        <input
          id={inputId}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onBlur={() => window.setTimeout(keepTyped, 120)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (matches[0]) choose(matches[0]);
              else keepTyped();
            }
          }}
          type="text"
          autoComplete="address-level2"
          enterKeyHint="done"
          placeholder="תל אביב, חיפה, באר שבע…"
          aria-describedby={listId}
          className="field"
        />

        <p id={listId} aria-live="polite" className="sr-only">
          {open && query.trim() ? `${matches.length} יישובים מתאימים` : ""}
        </p>

        {open && matches.length > 0 && (
          <ul className="mt-2 space-y-1">
            {matches.map((place) => (
              <li key={place.name}>
                <button
                  type="button"
                  // onMouseDown, so the choice lands before the input's blur closes the list.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(place)}
                  className="tape tape-flat flex min-h-11 w-full items-center px-3 text-start text-[0.95rem] font-semibold text-ink"
                >
                  {place.name}
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={useMyLocation}
          disabled={geo === "asking"}
          // btn-ghost, not btn-quiet: this panel sits on the counter, and btn-quiet is
          // the paper variant (its ink colour fails contrast against the dark counter).
          className="btn btn-ghost mt-3 flex min-h-11 w-full items-center justify-center gap-2 disabled:opacity-60"
        >
          <PinIcon size={18} />
          {geo === "asking" ? "מאתרים…" : "השתמשו במיקום שלי"}
        </button>

        {geo === "denied" && (
          <p className="mt-2 text-sm text-on-ground-2">
            הדפדפן לא נתן לנו את המיקום. אפשר פשוט להקליד את היישוב.
          </p>
        )}
        {geo === "unavailable" && (
          <p className="mt-2 text-sm text-on-ground-2">לא הצלחנו לאתר אתכם. אפשר להקליד את היישוב.</p>
        )}
        {offBy !== null && offBy > 20 && (
          <p className="mt-2 text-sm text-on-ground-2">
            המיקום שקיבלנו רחוק מ{value.city}. אם זה לא נכון, הקלידו את היישוב.
          </p>
        )}
      </div>

      {chosen && (
        <div ref={radiusRef}>
          <h3
            id={headingId}
            className="mb-1.5 text-base font-bold text-on-ground"
          >
            כמה רחוק תיסעו בשביל מבצע?
          </h3>
          <p className="mb-2 text-sm text-on-ground-2">תמיד אפשר לשנות אחר כך.</p>
          <ul className="flex flex-wrap gap-2">
            {RADIUS_CHOICES.map((km) => {
              const active = value.radiusKm === km;
              return (
                <li key={km}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => onChange({ ...value, radiusKm: km })}
                    className={`tape tape-flat flex min-h-11 items-center rounded-xl px-3.5 text-[0.95rem] font-semibold text-ink ${
                      active ? "outline-[3px] outline-offset-0 outline-accent [outline-style:solid]" : ""
                    }`}
                  >
                    <span className="num">{radiusLabel(km)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <input type="hidden" name="homeCity" value={value.city} />
      <input type="hidden" name="homeLat" value={value.lat ?? ""} />
      <input type="hidden" name="homeLon" value={value.lon ?? ""} />
      <input type="hidden" name="radiusKm" value={value.radiusKm ?? ""} />
    </div>
  );
}
