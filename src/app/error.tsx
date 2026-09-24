"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-4xl">🍺</p>
      <h1 className="text-xl font-black">משהו השתבש</h1>
      <p className="text-sm opacity-60">נסו שוב. אם זה חוזר, כנראה שהשרת לא זמין כרגע.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded-2xl bg-[color:var(--accent)] px-5 py-3 text-sm font-bold text-[color:var(--base)]"
      >
        ניסיון נוסף
      </button>
    </main>
  );
}
