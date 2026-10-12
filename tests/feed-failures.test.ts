import { describe, expect, it, vi } from "vitest";
import { orEmpty, rows } from "@/lib/feed-result";

/**
 * Staging taught this one. With a broken anon key every catalogue read failed,
 * each reader ended `data ?? []`, and unstable_cache stored "no beers" for the
 * full five-minute TTL — so fixing the key did not fix the screen. A failed read
 * is not an answer and must never be cached as one.
 */
describe("a feed read that fails", () => {
  it("throws, so nothing is written to the cache", () => {
    expect(() => rows({ data: null, error: { message: "Invalid API key" } }, "beers")).toThrowError(
      /beers: Invalid API key/,
    );
  });

  it("is not the same as a genuinely empty table", () => {
    expect(rows<{ id: number }>({ data: [], error: null }, "beers")).toEqual([]);
    expect(rows<{ id: number }>({ data: [{ id: 1 }], error: null }, "beers")).toEqual([{ id: 1 }]);
  });

  it("degrades for one request instead of for the whole TTL", async () => {
    const reader = vi.fn().mockRejectedValueOnce(new Error("refused")).mockResolvedValueOnce(["goldstar"]);
    const first = await orEmpty(reader, [] as string[], "beers");
    const second = await orEmpty(reader, [] as string[], "beers");

    expect(first).toEqual([]);      // this request sees nothing…
    expect(second).toEqual(["goldstar"]); // …and the next one asks again
    expect(reader).toHaveBeenCalledTimes(2);
  });
});
