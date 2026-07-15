"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Owner-area navigation, rendered inline in the dark 60px top bar: three
 * dropdown groups (Rosters / Team / Orders) + standalone Forms and Settings
 * links. Dropdowns open on hover AND click (Escape + outside-click to close) on
 * desktop; a hamburger panel drops below the bar on mobile. The active route is
 * highlighted on both the group (green underline) and the item.
 *
 * Navigation/labels only — every destination keeps its current URL. "Forms" is
 * an app feature not present in the design handoff; it's retained here.
 */

type NavItem = { label: string; href: string; icon: string };
type NavGroup = { label: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    label: "Rosters",
    items: [
      { label: "Rosters", href: "/app/periods", icon: "calendar_month" },
      { label: "Shift types", href: "/app/templates", icon: "category" },
      { label: "Shifts", href: "/app/shifts", icon: "grid_view" },
      { label: "Timesheets", href: "/app/timesheets", icon: "schedule" },
      { label: "Reports", href: "/app/reports", icon: "monitoring" },
    ],
  },
  {
    label: "Team",
    items: [
      { label: "Staff", href: "/app/staff", icon: "group" },
      {
        label: "People (all locations)",
        href: "/app/people",
        icon: "diversity_3",
      },
      { label: "Leave", href: "/app/leave", icon: "beach_access" },
      {
        label: "Certifications",
        href: "/app/certifications",
        icon: "verified",
      },
    ],
  },
  {
    label: "Orders",
    items: [
      // Route is /app/stock; nav label only is "Stock levels".
      { label: "Stock levels", href: "/app/stock", icon: "inventory" },
      { label: "Items", href: "/app/items", icon: "list_alt" },
      { label: "Suppliers", href: "/app/suppliers", icon: "local_shipping" },
    ],
  },
];

const STANDALONE: NavItem[] = [
  { label: "Forms", href: "/app/forms", icon: "description" },
  { label: "Settings", href: "/app/settings", icon: "settings" },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function groupIsActive(pathname: string, group: NavGroup): boolean {
  return group.items.some((item) => isActive(pathname, item.href));
}

const triggerBase =
  "flex h-[60px] items-center gap-1 px-[14px] text-[13.5px] font-semibold transition-colors";
const activeTrigger =
  "text-[var(--color-accent)] shadow-[inset_0_-2px_0_var(--color-accent)]";
const idleTrigger = "text-[#C7CDD6] hover:text-white";

export function OwnerNav() {
  const pathname = usePathname();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  // Close everything when the route changes (e.g. after navigating).
  useEffect(() => {
    setOpenGroup(null);
    setMobileOpen(false);
  }, [pathname]);

  // Escape closes any open menu; outside-click closes dropdowns.
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
    <nav ref={navRef} aria-label="Main" className="contents">
      {/* Desktop: grouped dropdowns inline in the bar. */}
      <div className="ml-[18px] hidden h-[60px] items-stretch md:flex">
        {GROUPS.map((group) => {
          const active = groupIsActive(pathname, group);
          const open = openGroup === group.label;
          const menuId = `nav-group-${group.label}`;
          return (
            <div
              key={group.label}
              className="relative flex items-stretch"
              onMouseEnter={() => setOpenGroup(group.label)}
              onMouseLeave={() => setOpenGroup(null)}
            >
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
                className={`${triggerBase} ${active ? activeTrigger : idleTrigger}`}
              >
                {group.label}
                <span
                  aria-hidden="true"
                  className={`material-symbols-rounded text-[16px] opacity-70 transition-transform ${
                    open ? "rotate-180" : ""
                  }`}
                >
                  expand_more
                </span>
              </button>
              {open ? (
                <div
                  id={menuId}
                  role="menu"
                  className="absolute left-2 top-[54px] z-[70] min-w-[196px] rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-[0_18px_40px_rgba(17,24,39,0.20)] [animation:rosterFade_0.14s_ease]"
                >
                  {group.items.map((item) => {
                    const itemActive = isActive(pathname, item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        role="menuitem"
                        className={`flex items-center gap-2.5 rounded-[8px] px-[11px] py-[9px] text-[13px] hover:bg-[var(--color-accent-faint)] hover:text-[#3F6212] ${
                          itemActive
                            ? "bg-[var(--color-accent-faint)] font-semibold text-[#3F6212]"
                            : "text-[#374151]"
                        }`}
                      >
                        <span className="material-symbols-rounded text-[17px] text-[var(--color-text-muted)]">
                          {item.icon}
                        </span>
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
        {STANDALONE.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${triggerBase} ${active ? activeTrigger : idleTrigger}`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      {/* Mobile: hamburger toggling a panel dropped below the bar. */}
      <button
        type="button"
        aria-expanded={mobileOpen}
        aria-label="Menu"
        onClick={() => setMobileOpen((open) => !open)}
        className="ml-2 flex h-10 w-10 items-center justify-center rounded-[9px] text-[#D1D5DB] hover:bg-[var(--color-header-hover)] md:hidden"
      >
        <span
          aria-hidden="true"
          className="material-symbols-rounded text-[24px]"
        >
          {mobileOpen ? "close" : "menu"}
        </span>
      </button>
      {mobileOpen ? (
        <div className="absolute inset-x-0 top-[60px] z-[60] max-h-[calc(100vh-60px)] overflow-y-auto border-t border-[#1F2937] bg-[var(--color-header)] px-4 pb-4 pt-2 shadow-[0_18px_40px_rgba(0,0,0,0.4)] md:hidden">
          {[...GROUPS, { label: "More", items: STANDALONE }].map((group) => (
            <div key={group.label} className="mt-3">
              <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                {group.label}
              </p>
              <ul>
                {group.items.map((item) => {
                  const itemActive = isActive(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`flex min-h-11 items-center gap-3 rounded-[8px] px-3 py-2 text-[14px] hover:bg-white/10 ${
                          itemActive
                            ? "font-semibold text-[var(--color-accent)]"
                            : "text-[var(--color-header-ink)]"
                        }`}
                      >
                        <span className="material-symbols-rounded text-[19px] opacity-80">
                          {item.icon}
                        </span>
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </nav>
  );
}
