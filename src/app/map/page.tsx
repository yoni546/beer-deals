import { Screen, TopBar } from "@/components/Chrome";
import { MeLink } from "@/components/ui/MeLink";
import { MapScreen } from "@/components/map/MapScreen";
import { getMapPins, getTownPins } from "@/lib/map";
import { getViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

type Search = { lat?: string; lon?: string; km?: string };

/** The middle of the country, for framing the map before a town is chosen. */
const ISRAEL = { lat: 31.6, lon: 34.95 };
/** Zoomed out far enough to show it all. */
const COUNTRY_KM = 150;

/**
 * The deals around a place, on a map.
 *
 * WHERE THE POINT COMES FROM, in this order: the one in the URL (so the view is
 * shareable and the place picker can move it without a second data path), else
 * the place the person already saved in their profile. It is never asked for
 * silently — the browser's location prompt only ever follows an explicit tap, in
 * PlacePicker, exactly as it does everywhere else in this app.
 *
 * AND NOBODY HAS TO HAVE ONE TO OPEN THIS. Without a point the map still opens,
 * over the country, with the picker on it. Wanting to see another town's deals —
 * before a trip, for a parent, out of curiosity — is a real thing to want, and
 * the first version sent those people to a settings screen to earn the right to
 * look. The map is centred on the country then, which is a frame and not a
 * claim: no pins are drawn, because there is no "near" without a near, and
 * showing the country's deals as if they were around you would be exactly the
 * lie this feature is built to avoid.
 *
 * WHAT IS MISSING FROM IT, said on the screen rather than hidden: a branch we
 * cannot place is not drawn (0057), so the map is never the whole truth about
 * where a deal runs. The deal itself is on its chain's page either way.
 */
export default async function MapPage({ searchParams }: { searchParams: Promise<Search> }) {
  const query = await searchParams;
  const viewer = await getViewer();
  const profile = viewer.profile ?? null;

  const asNumber = (raw: string | undefined) => {
    const value = Number(raw);
    return raw !== undefined && raw !== "" && Number.isFinite(value) ? value : null;
  };

  const lat = asNumber(query.lat) ?? profile?.home_lat ?? null;
  const lon = asNumber(query.lon) ?? profile?.home_lon ?? null;
  const radiusKm = asNumber(query.km) ?? profile?.search_radius_km ?? 15;

  // NOBODY HAS TO SAY WHERE THEY LIVE TO OPEN THIS (the owner's rule, 2026-10-25).
  // Without a point the map still opens, over the country, with the picker on it:
  // somebody looking at another town's deals is a real thing to want, and sending
  // them to a settings screen to get there was a wall for no reason. Nothing is
  // drawn until a town is chosen, because there is no "near" without a near.
  const chosen = lat !== null && lon !== null;
  // "בכל הארץ" is radius 0 — the same reading search_radius_km has everywhere
  // else. It cannot be served by widening the radius: offers_near orders by
  // distance and PostgREST caps any answer at 1,000 rows, so "no limit" came
  // back as the nearest hundred branches around one city. The country is drawn
  // by town instead (0064), which is also the only readable way to draw it.
  const countrywide = chosen && radiusKm === 0;
  const centre = chosen && !countrywide ? { lat, lon } : ISRAEL;

  const pins = !chosen ? [] : countrywide ? await getTownPins() : await getMapPins(lat, lon, radiusKm);
  const deals = pins.reduce((total, pin) => total + (pin.towns?.deals ?? pin.offers.length), 0);
  const approximate = pins.filter((pin) => pin.precision === "locality").length;

  return (
    <Screen bare>
      <div className="px-4 pt-4">
        <TopBar
          title="מפה"
          action={<MeLink />}
          sub={
            !chosen
              ? "בחרו יישוב, או שתפו מיקום — ותראו מה יש שם במבצע"
              : countrywide
                ? `${deals} מבצעים ב־${pins.length} יישובים בכל הארץ`
                : pins.length
                ? `${deals} מבצעים ב־${pins.length} סניפים, עד ${radiusKm} ק״מ`
                : `אין מבצעים בסניפים שאנחנו יודעים למקם, עד ${radiusKm} ק״מ`
          }
        />
      </div>

      <MapScreen
        pins={pins}
        centre={centre}
        radiusKm={chosen && !countrywide ? radiusKm : COUNTRY_KM}
        place={{
          city: profile?.home_city ?? "",
          lat: chosen ? lat : null,
          lon: chosen ? lon : null,
          radiusKm,
        }}
      />

      {/* What the map cannot say, in words rather than by omission. */}
      {countrywide && (
        <p className="px-4 pt-3 text-xs leading-relaxed text-on-ground-2">
          בתצוגת כל הארץ כל נקודה היא יישוב, לא סניף. בחרו מרחק כדי לראות את הסניפים עצמם ואת המבצעים שבהם.
        </p>
      )}

      {!countrywide && approximate > 0 && (
        <p className="px-4 pt-3 text-xs leading-relaxed text-on-ground-2">
          {approximate === pins.length
            ? "כל הסניפים כאן ממוקמים לפי מרכז היישוב, לא לפי הכתובת המדויקת."
            : `${approximate} מהסניפים כאן ממוקמים לפי מרכז היישוב, לא לפי הכתובת המדויקת.`}{" "}
          סניף שאין לנו עליו מיקום כלל אינו מופיע על המפה — המבצע שלו עדיין נמצא בדף הרשת.
        </p>
      )}
    </Screen>
  );
}
