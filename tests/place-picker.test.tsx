// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlacePicker, EMPTY_PLACE, type Place } from "@/components/PlacePicker";

/**
 * Where a person lives, and how far they will go.
 *
 * The bug this file exists for: the blur on the town field is DELAYED on purpose,
 * so that a click on a suggestion lands before the list closes. That delayed work
 * used to spread the place as it was when the blur happened — so choosing a town
 * and then tapping a distance wrote the town back over the distance 120 ms later,
 * silently resetting it. It reached the e2e suite as an intermittent failure, which
 * is the worst way for a real bug to present itself.
 */

/** The picker is controlled; a test needs the state the real screens hold for it. */
function Harness({ onPlace }: { onPlace: (place: Place) => void }) {
  const [place, setPlace] = useState<Place>(EMPTY_PLACE);
  return (
    <PlacePicker
      value={place}
      onChange={(next) => {
        setPlace(next);
        onPlace(next);
      }}
    />
  );
}

function renderPicker() {
  let place: Place = EMPTY_PLACE;
  render(<Harness onPlace={(next) => (place = next)} />);
  return {
    field: screen.getByLabelText("איפה אתם גרים?"),
    get place() {
      return place;
    },
  };
}

// jsdom has no layout, so it has no scrollIntoView; the picker brings the distance
// question into view as soon as a place is known.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  // Auto-cleanup is not on in this project's vitest config, so each test tidies up —
  // otherwise the second render finds two of every field.
  cleanup();
});

describe("choosing a place and a distance", () => {
  it("keeps the distance when the town field's delayed blur arrives afterwards", () => {
    const picker = renderPicker();

    fireEvent.change(picker.field, { target: { value: "חיפה" } });
    fireEvent.click(screen.getByRole("button", { name: "חיפה" }));
    expect(picker.place.city).toBe("חיפה");

    // Tapping anything else blurs the field, which schedules the delayed work.
    // focusOut, not blur: React attaches onBlur to focusout, and a plain non-bubbling
    // 'blur' event never reaches it -- a test that fires one proves nothing.
    fireEvent.focusOut(picker.field);
    fireEvent.click(screen.getByRole("button", { name: "עד 25 ק״מ" }));
    expect(picker.place.radiusKm).toBe(25);

    // …and now it arrives. It must not undo the distance.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(picker.place).toMatchObject({ city: "חיפה", radiusKm: 25 });
    expect(screen.getByRole("button", { name: "עד 25 ק״מ" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("still keeps a town it does not hold, typed and left", () => {
    const picker = renderPicker();
    fireEvent.change(picker.field, { target: { value: "כפר שלא קיים" } });
    fireEvent.focusOut(picker.field);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    // A real answer: the name, with no coordinates, which is why distances are absent
    // for them rather than invented.
    expect(picker.place).toMatchObject({ city: "כפר שלא קיים", lat: null, lon: null });
  });

  it("the distance question only appears once a place is known", () => {
    renderPicker();
    expect(screen.queryByRole("button", { name: "עד 25 ק״מ" })).toBeNull();
  });
});
