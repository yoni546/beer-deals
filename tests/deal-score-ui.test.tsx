// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DealScoreChip } from "@/components/ui/DealScore";
import { readFileSync } from "node:fs";

/**
 * How the score reaches the screen.
 *
 * The rule the database sets (docs/DEAL-SCORE.md) has to survive the journey: an
 * offer with no score shows NO score, not a zero and not a placeholder.
 */

describe("the Deal Score on a line", () => {
  it("shows nothing at all when there is no score", () => {
    // jest-dom's matchers are not installed here, so assert on the DOM directly.
    const { container } = render(<DealScoreChip score={null} />);
    expect(container.innerHTML).toBe("");
    const undef = render(<DealScoreChip score={undefined} />);
    expect(undef.container.innerHTML).toBe("");
  });

  it("names the band in words, not in colour alone", () => {
    render(<DealScoreChip score={{ score: 94, band: "amazing" }} />);
    expect(screen.getByText("מטורף")).toBeTruthy();
    expect(screen.getByText("94")).toBeTruthy();
  });

  it("reads the whole thing out to a screen reader", () => {
    render(<DealScoreChip score={{ score: 61, band: "fair" }} />);
    // The number beside the word is aria-hidden, so the figure has to be said in full
    // somewhere: "ציון מבצע 61 מתוך 100, סביר".
    expect(screen.getByText(/ציון מבצע 61 מתוך 100/)).toBeTruthy();
  });

  it("has a word for every band the database can produce", () => {
    for (const band of ["amazing", "very_good", "fair", "weak"] as const) {
      const { container, unmount } = render(<DealScoreChip score={{ score: 50, band }} />);
      expect(container.textContent?.trim().length, band).toBeGreaterThan(2);
      unmount();
    }
  });

  it("uses only contrast-verified text roles — never `danger` as text", () => {
    // The theme generator fixes `danger` at one lightness for both modes, which is why
    // the project uses it as a border and never as text on paper. A weak-band chip that
    // reached for text-danger would fail contrast in dark mode.
    const source = readFileSync("src/components/ui/DealScore.tsx", "utf8");
    expect(source).not.toMatch(/text-danger/);
    expect(source).toMatch(/ring-danger/);
  });

  it("carries no ad-hoc colour", () => {
    const source = readFileSync("src/components/ui/DealScore.tsx", "utf8");
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\b(bg|text|ring)-(red|green|amber|yellow|emerald|lime)-\d{2,3}\b/);
  });
});
