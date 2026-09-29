/**
 * Filter and sort state lives in the URL, so a choice survives a refresh, can be
 * shared, and the back button behaves. This builds the link for "the same page with
 * one thing changed", dropping values that equal the default to keep URLs short.
 */
export function withParams(
  path: string,
  current: Record<string, string | undefined>,
  patch: Record<string, string | undefined>,
  defaults: Record<string, string> = {},
): string {
  const merged = { ...current, ...patch };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === "" || value === defaults[key]) continue;
    query.set(key, value);
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}
