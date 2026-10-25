import { ButtonLink, EmptyState, Screen, TopBar } from "@/components/Chrome";
import { MapScreen } from "@/components/map/MapScreen";
import { getMapPins } from "@/lib/map";
import { getViewer } from "@/lib/session";

export const dynamic = "force-dynamic";

type Search = { lat?: string; lon?: string; km?: string };

/**
 * The deals around a place, on a map.
 *
 * WHERE THE POINT COMES FROM, in this order: the one in the URL (so the view is
 * shareable and the place picker can move it without a second data path), else
 * the place the person already saved in their profile. It is never asked for
 * silently — the browser's location prompt only ever follows an explicit tap, in
 * PlacePicker, exactly as it does everywhere else in this app.
 *
 * WITHOUT A POINT THERE IS NO MAP, and the screen says which of the two gaps it
 * is: somebody who has never set a place, or somebody whose town we hold but
 * cannot put a point on. Guessing the middle of the country and calling it "near
 * you" would be the lie this whole feature is built to avoid.
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

  if (lat === null || lon === null) {
    return (
      <Screen>
        <TopBar title="מפה" backHref="/" sub="המבצעים סביב נקודה" />
        <EmptyState title={profile?.home_city ? "אנחנו לא יודעים איפה זה" : "עוד לא אמרתם איפה אתם"}>
          {profile?.home_city
            ? `רשום אצלנו ${profile.home_city}, אבל אין לנו עליו נקודה על המפה. אפשר לבחור יישוב מהרשימה או לשתף מיקום.`
            : "בחרו יישוב, או שתפו מיקום, ונראה מה יש במבצע סביבכם."}
          <ButtonLink href="/settings">לבחירת מקום</ButtonLink>
        </EmptyState>
      </Screen>
    );
  }

  const pins = await getMapPins(lat, lon, radiusKm);
  const deals = pins.reduce((total, pin) => total + pin.offers.length, 0);
  const approximate = pins.filter((pin) => pin.precision === "locality").length;

  return (
    <Screen bare>
      <div className="px-4 pt-4">
        <TopBar
          title="מפה"
          backHref="/"
          sub={
            pins.length
              ? `${deals} מבצעים ב־${pins.length} סניפים, עד ${radiusKm} ק״מ`
              : `אין מבצעים בסניפים שאנחנו יודעים למקם, עד ${radiusKm} ק״מ`
          }
        />
      </div>

      <MapScreen
        pins={pins}
        centre={{ lat, lon }}
        radiusKm={radiusKm}
        place={{
          city: profile?.home_city ?? "",
          lat,
          lon,
          radiusKm,
        }}
      />

      {/* What the map cannot say, in words rather than by omission. */}
      {approximate > 0 && (
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
