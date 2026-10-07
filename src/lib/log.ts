import "server-only";

/**
 * Server-side logging.
 *
 * Until 0.10.4 nothing in the app logged anything: a failed read reached the error
 * screen and vanished, which is why the recurring failures were never diagnosed.
 * Every swallowed or contained failure now passes through here.
 *
 * One line per event, prefixed so it can be grepped out of a platform log, and
 * shaped so a monitoring integration can be added in exactly one place later
 * (Sentry's `captureException`, an OTel span — call it from `report`).
 *
 * Never log a token, a cookie, a push endpoint or a person's name. Ids are fine:
 * they identify a row, not a person, and the admin tooling already truncates the
 * ones that identify a device.
 */

type Fields = Record<string, string | number | boolean | null | undefined>;

function line(level: "warn" | "error", event: string, fields: Fields): string {
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`);
  return `[beer-deals] ${level} ${event}${parts.length ? ` ${parts.join(" ")}` : ""}`;
}

/** Something failed and the person saw a degraded screen. */
export function report(event: string, fields: Fields = {}): void {
  console.error(line("error", event, fields));
}

/** Something was not right but the screen is intact. */
export function note(event: string, fields: Fields = {}): void {
  console.warn(line("warn", event, fields));
}

/** The message of an unknown throw, never the stack (it can carry a connection string). */
export function reasonOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return "unknown";
}
