"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { switchLocationAction } from "@/app/app/locations/actions";

/**
 * Active-location picker in the dark owner header (M29). Shows the current
 * location's name; the dropdown lists all of the org's locations (submitting a
 * form to switch — the actual switch is server-validated), plus links to manage
 * or add locations. With a single location it still renders the name but the
 * dropdown offers "Add location". Escape / outside-click close it.
 */
export function LocationSwitcher({
  activeId,
  locations,
}: {
  activeId: string;
  locations: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = locations.find((l) => l.id === activeId);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
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
    <div ref={ref} className="relative ml-[7px] hidden sm:block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 border-l border-[#374151] py-1 pl-[13px] pr-2 text-[12.5px] text-[var(--color-text-muted)] transition-colors hover:text-white"
      >
        <span
          aria-hidden="true"
          className="material-symbols-rounded text-[15px] opacity-80"
        >
          storefront
        </span>
        <span className="max-w-[160px] truncate font-semibold text-[#D1D5DB]">
          {active?.name ?? "Select location"}
        </span>
        <span
          aria-hidden="true"
          className={`material-symbols-rounded text-[15px] opacity-70 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          expand_more
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-2 top-[40px] z-[70] min-w-[240px] rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-[0_18px_40px_rgba(17,24,39,0.20)] [animation:rosterFade_0.14s_ease]"
        >
          <p className="px-[11px] pb-1 pt-1.5 font-archivo text-[10.5px] font-bold uppercase tracking-[0.07em] text-[var(--color-text-muted)]">
            Locations
          </p>
          {locations.map((loc) => {
            const isActive = loc.id === activeId;
            return (
              <form key={loc.id} action={switchLocationAction}>
                <input type="hidden" name="businessId" value={loc.id} />
                <button
                  type="submit"
                  role="menuitem"
                  disabled={isActive}
                  className={`flex w-full items-center gap-2.5 rounded-[8px] px-[11px] py-[9px] text-left text-[13px] ${
                    isActive
                      ? "bg-[var(--color-accent-faint)] font-semibold text-[#13301F]"
                      : "text-[#374151] hover:bg-[var(--color-accent-faint)] hover:text-[#13301F]"
                  }`}
                >
                  <span
                    className={`material-symbols-rounded text-[17px] ${
                      isActive
                        ? "text-[#13301F]"
                        : "text-[var(--color-text-muted)]"
                    }`}
                  >
                    {isActive ? "check_circle" : "storefront"}
                  </span>
                  <span className="truncate">{loc.name}</span>
                </button>
              </form>
            );
          })}
          <div className="my-1.5 border-t border-[var(--color-border-subtle)]" />
          <Link
            href="/app/locations"
            role="menuitem"
            className="flex items-center gap-2.5 rounded-[8px] px-[11px] py-[9px] text-[13px] text-[#374151] hover:bg-[var(--color-bg)]"
          >
            <span className="material-symbols-rounded text-[17px] text-[var(--color-text-muted)]">
              settings
            </span>
            Manage locations
          </Link>
          <Link
            href="/app/locations#add"
            role="menuitem"
            className="flex items-center gap-2.5 rounded-[8px] px-[11px] py-[9px] text-[13px] font-semibold text-[#13301F] hover:bg-[var(--color-accent-faint)]"
          >
            <span className="material-symbols-rounded text-[17px]">add</span>
            Add location
          </Link>
        </div>
      ) : null}
    </div>
  );
}
