"use client";

import { useEffect, useRef } from "react";
// Imported here, at the top of the component the dynamic import pulls in, so the
// stylesheet travels in that chunk and no other screen asks for it.
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, Marker } from "leaflet";
import type { MapPin } from "@/lib/map";

/**
 * The map, and the ONLY place Leaflet is loaded.
 *
 * WHY IT IS LOADED LIKE THIS. A map library and its stylesheet are the heaviest
 * thing in this app by a wide margin, and the brief is explicit that the map must
 * not slow down the screens that are not it (§9). So Leaflet is imported inside
 * an effect, not at module scope: the chunk is fetched when this component
 * mounts, which only happens on /map. Home, the chain pages and search never ask
 * for it, and `next dynamic(..., { ssr: false })` around this component keeps it
 * out of the server render too — Leaflet needs a real `window`.
 *
 * WHERE THE TILES COME FROM, said plainly because it is the one thing about this
 * screen that leaves our own servers: OpenStreetMap's own tile servers. Drawing a
 * map means the viewer's browser asks a third party for image tiles, and that
 * third party sees their IP address. Migration 0039 weighed exactly this and
 * declined a map at the time; the owner and his partner chose the free route
 * knowingly on 2026-10-25. Attribution is required, and is on the map rather than
 * buried in a credits page.
 *
 * CARTO was the first choice and is no longer free without a key — its tiles come
 * back stamped "API KEY REQUIRED", which is the kind of thing only a screenshot
 * tells you. OSM's own servers need no key. Their usage policy asks for low,
 * non-commercial volume and a real identifying User-Agent, which a browser sends;
 * if this app ever grows past that, the honest move is a paid provider or our own
 * cache, not quietly leaning harder on donated hardware.
 *
 * WHAT IT DRAWS. One marker per branch that has a live deal inside the radius.
 * Branches we cannot place are not in the data at all (0057) — not at zero
 * distance, not at a town centre standing in for a shop.
 */
export function DealsMap({ pins, centre, radiusKm }: { pins: MapPin[]; centre: { lat: number; lon: number }; radiusKm: number }) {
  const holder = useRef<HTMLDivElement | null>(null);
  const map = useRef<LeafletMap | null>(null);
  const markers = useRef<Marker[]>([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !holder.current || map.current) return;

      const instance = L.map(holder.current, {
        center: [centre.lat, centre.lon],
        zoom: radiusKm <= 5 ? 13 : radiusKm <= 15 ? 12 : 10,
        // A map inside a scrolling page that grabs the wheel is a trap on a laptop
        // and a scroll-jail on a phone. Dragging and pinching still work.
        scrollWheelZoom: false,
        attributionControl: true,
      });

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(instance);

      map.current = instance;
    })();

    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      markers.current = [];
    };
    // Built once. The pins are applied by the effect below, so changing the point
    // does not tear the map down and rebuild it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      const instance = map.current;
      if (cancelled || !instance) return;

      for (const marker of markers.current) marker.remove();
      markers.current = [];

      for (const pin of pins) {
        // The marker is our own dot, not Leaflet's default image: that one is a PNG
        // fetched from the library's folder, and it is blue.
        const icon = L.divIcon({
          className: "",
          html: `<span class="map-pin"><span class="map-pin-count">${pin.offers.length}</span></span>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
          popupAnchor: [0, -14],
        });

        const marker = L.marker([pin.lat, pin.lon], { icon, title: pin.name })
          .addTo(instance)
          .bindPopup(popupHtml(pin), { closeButton: true, maxWidth: 260 });
        markers.current.push(marker);
      }

      instance.setView([centre.lat, centre.lon], instance.getZoom());
    })();

    return () => {
      cancelled = true;
    };
  }, [pins, centre]);

  return <div ref={holder} className="map-canvas" role="application" aria-label="מפת המבצעים" />;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const shekels = (agorot: number) => `₪${Math.floor(agorot / 100)}.${String(agorot % 100).padStart(2, "0")}`;

/**
 * What kind of deal this is, in a word (§8).
 *
 * A price cut says nothing here: the saving beside the price already says it, and
 * a label repeating it would be noise on the smallest surface in the app. The
 * others change what you have to DO to get the price, which the price alone hides
 * — "2 ב־₪35" is not ₪35, and a club price is not a price you can simply pay.
 *
 * The exact terms (how many, for how much, which club) live in `conditions`, and
 * `conditionChips` renders them on the chain and beer pages. They are not
 * duplicated into this string: a popup that tries to be the deal line ends up a
 * worse copy of it, and the pin links nowhere else precisely because the tape is
 * where a deal is read.
 */
const PROMO_HE: Record<string, string> = {
  multi_buy: "מבצע כמותי",
  club_price: "מחיר מועדון",
  coupon: "בקופון",
  gift: "עם מתנה",
  other: "מבצע",
};

/**
 * What a pin says when it is tapped (§8): the shop, and each beer it has on
 * offer with its own photo, its price and how far away it is.
 *
 * It is a string because Leaflet owns the popup's DOM. Everything interpolated is
 * escaped: these values come from chain feeds, which are somebody else's data.
 */
function popupHtml(pin: MapPin): string {
  const distance = pin.km === null ? "" : `<span class="map-pop-km num">${pin.km < 1 ? `${Math.round(pin.km * 1000)} מ׳` : `${pin.km.toFixed(1)} ק״מ`}</span>`;
  const whereabouts = pin.precision === "locality" ? '<p class="map-pop-note">מיקום משוער — מרכז היישוב</p>' : "";

  const lines = pin.offers
    .slice()
    .sort((a, b) => (b.value_pct ?? -1) - (a.value_pct ?? -1) || a.effective_agorot - b.effective_agorot)
    .map((offer) => {
      const photo = `/bottles/${offer.beer_slug}@216.webp`;
      const saving = offer.value_pct === null ? "" : `<span class="map-pop-save num">−${offer.value_pct}%</span>`;
      const kind = offer.promo_type ? PROMO_HE[offer.promo_type] : null;
      const under = [offer.pack_label, kind].filter(Boolean).join(" · ");
      const pack = under ? `<span class="map-pop-pack">${escapeHtml(under)}</span>` : "";
      return `<li class="map-pop-row">
        <img src="${photo}" alt="" width="14" height="55" loading="lazy" decoding="async" onerror="this.remove()" />
        <span class="map-pop-beer">${escapeHtml(offer.beer_name)}${pack}</span>
        ${saving}
        <span class="map-pop-price num">${shekels(offer.effective_agorot)}</span>
      </li>`;
    })
    .join("");

  return `<div class="map-pop">
    <p class="map-pop-head">${escapeHtml(pin.storeName)}${pin.name && pin.name !== pin.storeName ? ` · ${escapeHtml(pin.name)}` : ""}${distance}</p>
    ${whereabouts}
    <ul class="map-pop-list">${lines}</ul>
  </div>`;
}
