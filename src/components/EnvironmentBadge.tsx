import { describeEnvironment } from "@/lib/environment";

/**
 * Says out loud which environment you are looking at. Renders nothing in
 * production and in tests. A non-production environment that is connected to the
 * production database gets a red warning instead of a badge, because that is the
 * one combination where clicking "approve" affects real users.
 */
export function EnvironmentBadge() {
  const { name, usesProductionDatabase } = describeEnvironment();
  if (name === "production" || name === "test") return null;

  if (usesProductionDatabase) {
    return (
      <div
        role="alert"
        className="fixed inset-x-0 bottom-0 z-50 bg-red-700 px-3 py-1.5 text-center text-xs font-bold text-white"
        dir="rtl"
      >
        אזהרה: הסביבה הזו ({name}) מחוברת לבסיס הנתונים של האתר החי. כל שינוי משפיע על משתמשים אמיתיים.
      </div>
    );
  }

  return (
    <div
      dir="ltr"
      className="pointer-events-none fixed top-1 left-1 z-50 rounded bg-fuchsia-700/90 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase"
    >
      {name}
    </div>
  );
}
