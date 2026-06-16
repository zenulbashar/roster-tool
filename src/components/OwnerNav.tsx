"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

/**
 * Owner-area navigation: four top-level groups (three dropdowns + a standalone
 * Settings link) on the Zaleit-branded dark header. Click-to-open dropdowns
 * (Escape + outside-click to close) on desktop; a real hamburger panel on
 * mobile. Active route is highlighted on both the group and the item.
 *
 * Navigation/labels only — every destination keeps its current URL.
 */

type NavItem = { label: string; href: string };
type NavGroup = { label: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    label: "Rosters",
    items: [
      { label: "Rosters", href: "/app/periods" },
      { label: "Shift types", href: "/app/templates" },
      { label: "Shifts", href: "/app/shifts" },
      { label: "Timesheets", href: "/app/timesheets" },
      { label: "Reports", href: "/app/reports" },
    ],
  },
  {
    label: "Team",
    items: [
      { label: "Staff", href: "/app/staff" },
      { label: "Leave", href: "/app/leave" },
      { label: "Certifications", href: "/app/certifications" },
    ],
  },
  {
    label: "Orders",
    items: [
      // Route is /app/stock; nav label only is "Stock levels".
      { label: "Stock levels", href: "/app/stock" },
      { label: "Items", href: "/app/items" },
      { label: "Suppliers", href: "/app/suppliers" },
    ],
  },
];

const FORMS: NavItem = { label: "Forms", href: "/app/forms" };
const SETTINGS: NavItem = { label: "Settings", href: "/app/settings" };

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function groupIsActive(pathname: string, group: NavGroup): boolean {
  return group.items.some((item) => isActive(pathname, item.href));
}

export function OwnerNav() {
  const pathname = usePathname();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const mobilePanelId = useId();

  // Close everything when the route changes (e.g. after navigating).
  useEffect(() => {
    setOpenGroup(null);
    setMobileOpen(false);
  }, [pathname]);

  // Escape closes any open menu; outside-click closes desktop dropdowns.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenGroup(null);
        setMobileOpen(false);
      }
    }
    function onPointerDown(event: PointerEvent) {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setOpenGroup(null);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  return (
    <nav ref={navRef} aria-label="Main">
      {/* Desktop: grouped dropdowns. Hidden on small screens. */}
      <div className="mx-auto hidden max-w-3xl items-center gap-1 px-5 pb-2 text-sm font-medium md:flex">
        {GROUPS.map((group) => {
          const active = groupIsActive(pathname, group);
          const open = openGroup === group.label;
          const menuId = `nav-group-${group.label}`;
          return (
            <div key={group.label} className="relative">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={menuId}
                onClick={() =>
                  setOpenGroup((current) =>
                    current === group.label ? null : group.label,
                  )
                }
                className={`flex items-center gap-1 rounded-md px-3 py-2 text-[var(--color-header-ink)] hover:bg-white/10 ${
                  active
                    ? "border-b-2 border-[var(--color-accent)] font-semibold"
                    : "border-b-2 border-transparent"
                }`}
              >
                {group.label}
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              {open ? (
                <div
                  id={menuId}
                  role="menu"
                  className="absolute left-0 top-full z-50 mt-1 min-w-44 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-lg"
                >
                  {group.items.map((item) => {
                    const itemActive = isActive(pathname, item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        role="menuitem"
                        className={`block rounded-md px-3 py-2 text-[var(--color-ink)] hover:bg-[var(--color-canvas)] ${
                          itemActive
                            ? "font-semibold text-[var(--color-accent)]"
                            : ""
                        }`}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
        <Link
          href={FORMS.href}
          className={`rounded-md px-3 py-2 text-[var(--color-header-ink)] hover:bg-white/10 ${
            isActive(pathname, FORMS.href)
              ? "border-b-2 border-[var(--color-accent)] font-semibold"
              : "border-b-2 border-transparent"
          }`}
        >
          {FORMS.label}
        </Link>
        <Link
          href={SETTINGS.href}
          className={`rounded-md px-3 py-2 text-[var(--color-header-ink)] hover:bg-white/10 ${
            isActive(pathname, SETTINGS.href)
              ? "border-b-2 border-[var(--color-accent)] font-semibold"
              : "border-b-2 border-transparent"
          }`}
        >
          {SETTINGS.label}
        </Link>
      </div>

      {/* Mobile: hamburger toggling a stacked panel. Hidden on md+. */}
      <div className="mx-auto max-w-3xl px-5 pb-2 md:hidden">
        <button
          type="button"
          aria-expanded={mobileOpen}
          aria-controls={mobilePanelId}
          onClick={() => setMobileOpen((open) => !open)}
          className="flex min-h-12 items-center gap-2 rounded-md px-3 py-2 text-[var(--color-header-ink)] hover:bg-white/10"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            {mobileOpen ? (
              <path d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
          <span className="text-sm font-medium">Menu</span>
        </button>
        {mobileOpen ? (
          <div id={mobilePanelId} className="mt-2 space-y-3 pb-2">
            {GROUPS.map((group) => (
              <div key={group.label}>
                <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-header-muted)]">
                  {group.label}
                </p>
                <ul>
                  {group.items.map((item) => {
                    const itemActive = isActive(pathname, item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={`flex min-h-12 items-center rounded-md px-3 py-2 text-[var(--color-header-ink)] hover:bg-white/10 ${
                            itemActive
                              ? "font-semibold text-[var(--color-accent)]"
                              : ""
                          }`}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            <Link
              href={FORMS.href}
              className={`flex min-h-12 items-center rounded-md px-3 py-2 text-[var(--color-header-ink)] hover:bg-white/10 ${
                isActive(pathname, FORMS.href)
                  ? "font-semibold text-[var(--color-accent)]"
                  : ""
              }`}
            >
              {FORMS.label}
            </Link>
            <Link
              href={SETTINGS.href}
              className={`flex min-h-12 items-center rounded-md px-3 py-2 text-[var(--color-header-ink)] hover:bg-white/10 ${
                isActive(pathname, SETTINGS.href)
                  ? "font-semibold text-[var(--color-accent)]"
                  : ""
              }`}
            >
              {SETTINGS.label}
            </Link>
          </div>
        ) : null}
      </div>
    </nav>
  );
}
