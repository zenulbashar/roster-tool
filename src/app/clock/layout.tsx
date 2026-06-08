/**
 * Personal clock-in shell. Bare, like the kiosk — reached only via the
 * capability link on a staff member's own phone. Mobile-first, high-contrast.
 */
export default function ClockLayout({
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
