"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The admin console's two-tab nav (Clients / Activity log). Active tab = white
 * text with an indigo underline (inset box-shadow), matching the design's
 * `#A5B4FC` accent. Kept minimal — the admin area is intentionally small.
 */
const TABS = [
  { href: "/admin/clients", label: "Clients", match: "/admin/clients" },
  { href: "/admin/log", label: "Activity log", match: "/admin/log" },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="ml-4 flex items-center gap-1" aria-label="Admin sections">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.match);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-[8px] px-[13px] py-[8px] text-[13.5px] font-semibold transition-colors ${
              active
                ? "text-white shadow-[inset_0_-2px_0_#A5B4FC]"
                : "text-[#C7D2FE] hover:text-white"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
