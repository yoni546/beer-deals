"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PlacePicker, type Place } from "@/components/PlacePicker";
import type { MapPin } from "@/lib/map";

/**
 * The map screen's client half: where to look, and the map itself.
 *
 * THE LIBRARY IS NOT HERE. `dynamic(..., { ssr: false })` means the Leaflet chunk
 * is fetched when this screen mounts and never by any other — the brief's §9.
 * `ssr: false` is also not optional: Leaflet reaches for `window` as it loads.
 *
 * CHANGING THE PLACE GOES THROUGH THE URL, not through a fetch in here. The point
 * is a parameter of the page, so moving it re-renders the server component that
 * already knows how to read the deals around a point, and the map receives new
 * pins as props. No second data path, no client-side query, and the view is
 * shareable: /map?lat=…&lon=…&km=… is a place, and a link to it is that place.
 */
const DealsMap = dynamic(() => import("@/components/map/DealsMap").then((m) => m.DealsMap), {
  ssr: false,
});

export function MapScreen({
  pins,
  centre,
  radiusKm,
  place,
}: {
  pins: MapPin[];
  centre: { lat: number; lon: number };
  radiusKm: number;
  place: Place;
}) {
  const router = useRouter();
  const [value, setValue] = useState<Place>(place);

  return (
    <>
      <div className="px-4 pb-3">
        <PlacePicker
          value={value}
          onChange={(next) => {
            setValue(next);
            // A town with no coordinates is a real answer — it simply cannot move the
            // map, so the map stays where it is rather than jumping somewhere wrong.
            if (next.lat === null || next.lon === null) return;
            const km = next.radiusKm ?? radiusKm;
            router.replace(`/map?lat=${next.lat}&lon=${next.lon}&km=${km}`, { scroll: false });
          }}
        />
      </div>

      <DealsMap pins={pins} centre={centre} radiusKm={radiusKm} />
    </>
  );
}
