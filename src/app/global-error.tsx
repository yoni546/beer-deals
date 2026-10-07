"use client";

/**
 * The last boundary. `src/app/error.tsx` is a root-SEGMENT boundary, so it cannot
 * catch a throw in the root layout itself — and the root layout awaits the viewer to
 * pick favourite #1's palette, so it does reach the database. Without this file that
 * throw lands on Next's own screen: English, left-to-right, unstyled.
 *
 * It replaces <html>, so it carries its own document and its own colours. No design
 * tokens: the stylesheet may be exactly what failed to load.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="he" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: "100svh",
          display: "grid",
          placeItems: "center",
          padding: "1.5rem",
          background: "#1c150c",
          color: "#f6efe3",
          font: '1rem/1.6 system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        <main style={{ maxWidth: "26rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.375rem", margin: "0 0 0.75rem" }}>האפליקציה לא נטענה</h1>
          <p style={{ margin: "0 0 1.5rem", color: "#d6c9b3" }}>
            משהו נפל לפני שהצלחנו להציג משהו. המחירים לא נעלמו — נסו שוב בעוד רגע.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              font: "inherit",
              fontWeight: 700,
              minHeight: "2.75rem",
              width: "100%",
              padding: "0 1.25rem",
              borderRadius: "0.75rem",
              border: "none",
              background: "#f0b429",
              color: "#1c150c",
            }}
          >
            ניסיון נוסף
          </button>
          {error.digest && (
            <p style={{ marginTop: "1.5rem", fontSize: "0.75rem", color: "#9c8e78", direction: "ltr" }}>{error.digest}</p>
          )}
        </main>
      </body>
    </html>
  );
}
