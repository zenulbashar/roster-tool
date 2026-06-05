import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Roster — simple staff scheduling",
  description:
    "Build your team's weekly roster in minutes. Ask for availability, assign shifts, and send everyone their schedule.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-[var(--color-brand)] focus:px-4 focus:py-2 focus:text-[var(--color-brand-ink)]"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
