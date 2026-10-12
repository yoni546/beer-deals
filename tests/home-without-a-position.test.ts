import { describe, expect, it } from "vitest";
import { reasonWithoutPosition } from "@/lib/distance-reason";

/**
 * Staging, first run with real data behind it: a person set their town and the
 * screen still said "you didn't tell us where you are" — and offered a button to
 * a settings page where the town was already filled in.
 *
 * Two things are true at once and they are not the same: nothing geocodes the
 * town yet, and nothing geocodes the branches. Neither is the person's omission.
 */
describe("why there is no distance", () => {
  it("does not blame somebody who gave us a town", () => {
    expect(reasonWithoutPosition(true)).toBe("no_home_position");
  });

  it("still asks somebody who gave us nothing", () => {
    expect(reasonWithoutPosition(false)).toBe("no_home");
  });
});
