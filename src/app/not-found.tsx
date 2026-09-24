import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-4xl">🍺</p>
      <h1 className="text-xl font-black">לא מצאנו את הדף הזה</h1>
      <Link
        href="/"
        className="mt-2 rounded-2xl bg-[color:var(--accent)] px-5 py-3 text-sm font-bold text-[color:var(--base)]"
      >
        חזרה למבצעים
      </Link>
    </main>
  );
}
