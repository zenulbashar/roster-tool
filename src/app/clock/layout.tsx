/**
 * Personal clock-in shell. Bare, like the kiosk — reached only via the
 * capability link on a staff member's own phone. Dark, mobile-first,
 * high-contrast (matches the kiosk's visual language).
 */
export default function ClockLayout({
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
        className="mx-auto flex min-h-screen max-w-[460px] flex-col px-5 py-8"
      >
        {children}
      </main>
    </div>
  );
}
