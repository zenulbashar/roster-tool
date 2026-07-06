/**
 * Kiosk shell. Deliberately bare — no owner navigation or sign-out — since this
 * runs on a shared device reached only via the capability link. Dark, large and
 * high-contrast for a tablet by the door (matches the design handoff).
 */
export default function KioskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="min-h-screen text-white"
      style={{
        backgroundColor: "#0E1320",
        backgroundImage:
          "radial-gradient(circle at 50% -10%, #1a2335, #0E1320 55%)",
      }}
    >
      <main
        id="main"
        className="mx-auto flex min-h-screen max-w-[640px] flex-col px-6 py-9"
      >
        {children}
      </main>
    </div>
  );
}
