import { redirect } from "next/navigation";

/**
 * Superseded by /admin/people (migration 0041).
 *
 * This screen showed the people who had sent us deals. The people screen shows the
 * same rows, the same counts and the same blocking control — plus the town, radius
 * and beers the owner asked for — so keeping both would be two screens for one job,
 * drifting apart one wording at a time.
 *
 * A redirect rather than a deletion: the link is in somebody's history.
 */
export default function AdminSubmittersPage() {
  redirect("/admin/people");
}
