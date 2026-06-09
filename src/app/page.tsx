import Link from "next/link";

export default function HomePage() {
  return (
    <main id="main" className="mx-auto max-w-xl px-5 py-16">
      <h1 className="text-3xl font-bold tracking-tight text-[var(--color-ink)]">
        Roster
      </h1>
      <p className="mt-3 text-lg text-[var(--color-muted)]">
        Simple staff scheduling for small businesses. Ask your team when
        they&rsquo;re free, build the week&rsquo;s roster, and send everyone
        their shifts.
      </p>
      <div className="mt-8">
        <Link
          href="/sign-in"
          className="inline-block rounded-lg bg-[var(--color-button)] px-6 py-3 text-base font-semibold text-[var(--color-button-ink)] hover:opacity-90"
        >
          Get started
        </Link>
      </div>
    </main>
  );
}
