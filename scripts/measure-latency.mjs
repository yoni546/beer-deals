/**
 * How fast is a deployment, and where does its code actually run?
 *
 *   node scripts/measure-latency.mjs https://beer-deals.vercel.app
 *   node scripts/measure-latency.mjs https://beer-deals.vercel.app --runs 7
 *
 * Read-only. Each run makes one visit per page, reusing the anonymous session
 * cookie from the first response (so the run creates exactly one anonymous user,
 * like a single real visitor). Prints the Vercel function region from the
 * X-Vercel-Id header and the median / min / max time to first byte per page.
 *
 * Use it before and after changing the Vercel function region (docs/INFRASTRUCTURE.md).
 */
const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("usage: node scripts/measure-latency.mjs <https://site> [--runs N]");
  process.exit(1);
}
const runsFlag = process.argv.indexOf("--runs");
const runs = runsFlag > -1 ? Number(process.argv[runsFlag + 1]) : 5;
const pages = ["/whats-new", "/beer/goldstar", "/store/rami-levy", "/welcome"];

let cookie = "";
const timings = new Map(pages.map((page) => [page, []]));
const regions = new Set();

for (let run = 0; run < runs; run++) {
  for (const page of pages) {
    const started = performance.now();
    const response = await fetch(base + page, { headers: cookie ? { cookie } : {}, redirect: "manual" });
    // First byte: headers have arrived. (The body is cancelled; only latency matters.)
    const ttfb = performance.now() - started;
    await response.body?.cancel();

    const setCookies = response.headers.getSetCookie?.() ?? [];
    if (setCookies.length) cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
    const id = response.headers.get("x-vercel-id");
    if (id) regions.add(id.split("::").slice(0, 2).join(" → "));
    if (run > 0 || runs === 1) timings.get(page).push(ttfb); // run 0 is a cold start; report warm numbers
  }
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
console.log(`\n${base}`);
console.log(`edge → function region: ${[...regions].join(" | ") || "(no X-Vercel-Id header — not on Vercel?)"}\n`);
console.log("page".padEnd(22), "median".padStart(8), "min".padStart(8), "max".padStart(8), "  (ms to first byte, warm)");
for (const [page, values] of timings) {
  if (!values.length) continue;
  console.log(
    page.padEnd(22),
    median(values).toFixed(0).padStart(8),
    Math.min(...values).toFixed(0).padStart(8),
    Math.max(...values).toFixed(0).padStart(8),
  );
}
