/**
 * Kiosk shell. Deliberately bare — no owner navigation or sign-out — since this
 * runs on a shared device reached only via the capability link. Large, simple,
 * high-contrast for a tablet by the door.
 */
export default function KioskLayout({
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
