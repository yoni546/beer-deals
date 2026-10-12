/**
 * Why there are no distances, when we have no point to measure from.
 *
 * Its own module because src/lib/distance.ts is `server-only` and a test cannot
 * import it (the same reason trust.ts and feed-result.ts sit outside theirs).
 * The distinction is small and worth protecting: staging showed a person who had
 * set their town being told they had not, and sent to a settings screen where it
 * was already filled in.
 */
export type NoPositionReason = "no_home" | "no_home_position";

export function reasonWithoutPosition(hasTown: boolean): NoPositionReason {
  // A town is an answer. What is missing is a position for it — nothing geocodes
  // towns yet, exactly as nothing geocodes the branches — and that is our gap.
  return hasTown ? "no_home_position" : "no_home";
}
