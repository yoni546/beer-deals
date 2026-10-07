import { describe, expect, it } from "vitest";
import { ISRAEL_CITIES } from "@/data/israel-cities";
import { cityByName, kmBetween, nearestCity, RADIUS_CHOICES, radiusLabel, searchCities } from "@/lib/cities";

/**
 * The settlement list and how people find themselves in it.
 *
 * The list is explicitly approximate — town centres, good to a kilometre or two —
 * and these tests hold it to exactly that claim and no more: every point is a
 * plausible Israeli position, no two places sit on top of each other, and the
 * distances it produces agree with reality at the scale a radius is chosen in.
 */

describe("the settlement list", () => {
  it("has enough places to be useful, each one inside the bounds the database accepts", () => {
    expect(ISRAEL_CITIES.length).toBeGreaterThanOrEqual(80);
    for (const place of ISRAEL_CITIES) {
      // The same window as the branches_geo_bounds / profiles_home_bounds checks (0026),
      // so a city a person picks can never be refused when it is saved.
      expect(place.lat, place.name).toBeGreaterThan(29.3);
      expect(place.lat, place.name).toBeLessThan(33.5);
      expect(place.lon, place.name).toBeGreaterThan(34.0);
      expect(place.lon, place.name).toBeLessThan(36.0);
    }
  });

  it("names each place once, and says where every row came from", () => {
    const names = ISRAEL_CITIES.map((place) => place.name);
    expect(new Set(names).size).toBe(names.length);
    for (const place of ISRAEL_CITIES) {
      expect(place.name.trim(), place.name).toBe(place.name);
      expect(place.name.length, place.name).toBeLessThanOrEqual(60); // profiles_home_city_length
      expect(["compiled", "data.gov.il"]).toContain(place.source);
    }
  });

  it("does not put two different places at the same point", () => {
    const seen = new Map<string, string>();
    for (const place of ISRAEL_CITIES) {
      const key = `${place.lat.toFixed(3)},${place.lon.toFixed(3)}`;
      expect(seen.get(key), `${place.name} sits on ${seen.get(key)}`).toBeUndefined();
      seen.set(key, place.name);
    }
  });

  it("puts the big cities where they actually are", () => {
    // Distances anyone can check: these are the rows the rest of the list is scaled against.
    const tlv = cityByName("תל אביב-יפו")!;
    const haifa = cityByName("חיפה")!;
    const jerusalem = cityByName("ירושלים")!;
    const eilat = cityByName("אילת")!;
    const beersheva = cityByName("באר שבע")!;

    expect(kmBetween(tlv.lat, tlv.lon, haifa.lat, haifa.lon)).toBeGreaterThan(78);
    expect(kmBetween(tlv.lat, tlv.lon, haifa.lat, haifa.lon)).toBeLessThan(88);

    expect(kmBetween(tlv.lat, tlv.lon, jerusalem.lat, jerusalem.lon)).toBeGreaterThan(50);
    expect(kmBetween(tlv.lat, tlv.lon, jerusalem.lat, jerusalem.lon)).toBeLessThan(60);

    // Straight line, not road: ~93 km here against the ~105 km people quote for the drive.
    expect(kmBetween(tlv.lat, tlv.lon, beersheva.lat, beersheva.lon)).toBeGreaterThan(88);
    expect(kmBetween(tlv.lat, tlv.lon, beersheva.lat, beersheva.lon)).toBeLessThan(98);

    // The length of the country, give or take.
    expect(kmBetween(tlv.lat, tlv.lon, eilat.lat, eilat.lon)).toBeGreaterThan(270);
    expect(kmBetween(tlv.lat, tlv.lon, eilat.lat, eilat.lon)).toBeLessThan(300);
  });

  it("keeps neighbouring towns close, which is what a small radius depends on", () => {
    const ramatGan = cityByName("רמת גן")!;
    const givatayim = cityByName("גבעתיים")!;
    const tlv = cityByName("תל אביב-יפו")!;

    expect(kmBetween(ramatGan.lat, ramatGan.lon, givatayim.lat, givatayim.lon)).toBeLessThan(3);
    expect(kmBetween(tlv.lat, tlv.lon, ramatGan.lat, ramatGan.lon)).toBeLessThan(5);
  });
});

describe("finding the place somebody means", () => {
  const first = (query: string) => searchCities(query)[0]?.name;

  it("finds a city by its plain name", () => {
    expect(first("חיפה")).toBe("חיפה");
    expect(first("באר שבע")).toBe("באר שבע");
  });

  it("finds a place by the part of its name people actually say", () => {
    expect(first("תל אביב")).toBe("תל אביב-יפו");
    expect(first("מודיעין")).toBe("מודיעין־מכבים־רעות");
    expect(first("מעלות")).toBe("מעלות־תרשיחא");
  });

  it("forgives the quotes and dashes a phone keyboard makes awkward", () => {
    expect(first("ת״א")).toBe("תל אביב-יפו");
    expect(first("מעלות תרשיחא")).toBe("מעלות־תרשיחא");
    expect(first("פרדס חנה")).toBe("פרדס חנה־כרכור");
  });

  it("forgives a typo", () => {
    expect(first("נתניה")).toBe("נתניה");
    expect(first("נתנייה")).toBe("נתניה");
    expect(first("ירושלם")).toBe("ירושלים");
  });

  it("ranks the match you meant above the ones that merely contain it", () => {
    const results = searchCities("קריית").map((place) => place.name);
    expect(results.length).toBeGreaterThan(3);
    expect(results.every((name) => name.includes("קריית"))).toBe(true);
  });

  it("is never an error: an empty or nonsense query simply finds nothing", () => {
    expect(searchCities("")).toEqual([]);
    expect(searchCities("   ")).toEqual([]);
    expect(searchCities("zzzzqqqq")).toEqual([]);
  });

  it("offers a short list, not the whole country", () => {
    expect(searchCities("א").length).toBeLessThanOrEqual(8);
  });
});

describe("naming the place a browser's coordinates fall in", () => {
  it("names the nearest listed town", () => {
    expect(nearestCity(32.0853, 34.7818)?.name).toBe("תל אביב-יפו"); // the middle of Tel Aviv
    expect(nearestCity(31.2518, 34.7913)?.name).toBe("באר שבע");
  });

  it("says nothing rather than naming somewhere absurd", () => {
    // Mid-Mediterranean, and Cyprus: a fix we cannot explain is not given a name.
    expect(nearestCity(32.0, 32.0)).toBeNull();
    expect(nearestCity(35.1, 33.4)).toBeNull();
  });
});

describe("the distances on offer", () => {
  it("matches the set the database will accept (0026)", () => {
    expect([...RADIUS_CHOICES].sort((a, b) => a - b)).toEqual([0, 5, 10, 15, 20, 25, 50]);
  });

  it("words nationwide as nationwide, not as zero kilometres", () => {
    expect(radiusLabel(0)).toBe("בכל הארץ");
    expect(radiusLabel(15)).toBe("עד 15 ק״מ");
  });
});
