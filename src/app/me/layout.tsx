/**
 * Staff notices shell. Bare, like the clock surfaces — reached only via a
 * staff member's private capability link. Mobile-first, high-contrast. No
 * owner nav, no links into /app.
 */
export default function NoticesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[var(--color-canvas)]">
      <main id="main" className="mx-auto max-w-xl px-5 py-8">
        {children}
      </main>
    </div>
  );
}
