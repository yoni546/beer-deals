// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NearestBranch } from "@/components/NearestBranch";
import type { NearbyBranch } from "@/lib/distance";

/**
 * "12 ק״מ ממך" is not an answer to "where".
 *
 * The first thing somebody said after "closest to me" started working was that it
 * gave the distance and nothing else — not the branch, not the town, nothing to put
 * into Waze. These tests hold the two halves of the fix: that the line names the
 * place, and that the navigation link carries TEXT rather than the town-centre
 * coordinate we know is not the shop.
 */

const branch = (over: Partial<NearbyBranch> = {}): NearbyBranch => ({
  storeId: "s1",
  km: 12.4,
  branchName: "ויקטורי בית שאן",
  city: "בית שאן",
  address: "שדרות שאול המלך 42",
  ...over,
});

const hrefOf = (node: HTMLElement) => node.querySelector("a")?.getAttribute("href") ?? "";

describe("naming the branch a distance is to", () => {
  it("says which branch, in which town, at which address", () => {
    const { container } = render(<NearestBranch place={branch()} storeName="ויקטורי" />);
    const text = container.textContent ?? "";
    expect(text).toContain("ויקטורי בית שאן");
    expect(text).toContain("שדרות שאול המלך 42");
    expect(text).toContain("בית שאן");
  });

  it("navigates by searching for the shop, never by our coordinate", () => {
    // The coordinate is the TOWN CENTRE (0045). Handing it to a navigation app would
    // route somebody confidently to a roundabout, which is the lie this whole feature
    // was built to refuse. Waze gets the text and resolves it itself.
    const href = hrefOf(render(<NearestBranch place={branch()} storeName="ויקטורי" />).container);
    expect(href).toContain("waze.com/ul?q=");
    expect(href).toContain("navigate=yes");
    expect(decodeURIComponent(href)).toContain("ויקטורי בית שאן");
    expect(decodeURIComponent(href)).toContain("שדרות שאול המלך 42");
    // No latitude, no longitude, no `ll=` parameter.
    expect(href).not.toMatch(/ll=|latlng|&lat=|&lon=/);
  });

  it("still gets you there when the publisher gave no street", () => {
    const href = hrefOf(render(<NearestBranch place={branch({ address: null })} storeName="יוחננוף" />).container);
    expect(decodeURIComponent(href)).toContain("יוחננוף");
    expect(decodeURIComponent(href)).toContain("בית שאן");
    const text = render(<NearestBranch place={branch({ address: null })} storeName="יוחננוף" />).container.textContent ?? "";
    expect(text).toContain("בית שאן");
  });

  it("says nothing at all rather than an empty line", () => {
    const { container } = render(
      <NearestBranch place={branch({ branchName: null, city: null, address: null })} storeName="ויקטורי" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("opens in a new tab, safely", () => {
    const anchor = render(<NearestBranch place={branch()} storeName="ויקטורי" />).container.querySelector("a")!;
    expect(anchor.getAttribute("target")).toBe("_blank");
    expect(anchor.getAttribute("rel")).toContain("noopener");
  });
});
