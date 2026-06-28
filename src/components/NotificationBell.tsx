"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import {
  openNotificationAction,
  markAllNotificationsReadAction,
} from "@/app/app/notifications/actions";

/**
 * Owner header notification bell: an unread-count badge and a click-to-open
 * dropdown of recent notifications, styled for the dark header and following the
 * same open/close pattern as OwnerNav (Escape + outside-click close). Each item
 * is a form that marks it read and navigates to its link (works without client
 * JS for the action itself); a "Mark all as read" form and a link to the full
 * list round it out. Server-driven: the count is whatever the layout passed in,
 * refreshed on navigation/refresh.
 */

export type BellItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  linkPath: string | null;
  timeText: string;
  isRead: boolean;
};

/**
 * Per-type icon chip (Material Symbols Rounded). Purely decorative — colours
 * are token-backed; unknown types fall back to a neutral bell.
 */
const TYPE_ICONS: Record<string, { icon: string; bg: string; fg: string }> = {
  leave_requested: {
    icon: "event_busy",
    bg: "var(--color-warning-bg)",
    fg: "var(--color-warning)",
  },
  shift_offer_activity: {
    icon: "swap_horiz",
    bg: "var(--color-info-bg)",
    fg: "var(--color-info)",
  },
  stock_needs_order: {
    icon: "inventory_2",
    bg: "var(--color-accent-faint)",
    fg: "#3F6212",
  },
  cert_expiring: {
    icon: "workspace_premium",
    bg: "var(--color-danger-bg)",
    fg: "var(--color-danger-strong)",
  },
  availability_reply: {
    icon: "how_to_reg",
    bg: "var(--color-success-bg)",
    fg: "var(--color-success)",
  },
  form_response: {
    icon: "description",
    bg: "var(--color-info-bg)",
    fg: "var(--color-info)",
  },
};
const FALLBACK_ICON = {
  icon: "notifications",
  bg: "var(--color-bg)",
  fg: "var(--color-text-secondary)",
};

export function NotificationBell({
  unreadCount,
  items,
}: {
  unreadCount: number;
  items: BellItem[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
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

  const badge = unreadCount > 9 ? "9+" : String(unreadCount);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] text-[#D1D5DB] hover:bg-[var(--color-header-hover)]"
      >
        <span
          aria-hidden="true"
          className="material-symbols-rounded text-[22px]"
        >
          notifications
        </span>
        {unreadCount > 0 ? (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 inline-flex h-[17px] w-[17px] items-center justify-center"
          >
            <span className="absolute inset-0 rounded-full bg-[var(--color-danger-strong)] [animation:rosterPulse_2.2s_ease-out_infinite]" />
            <span className="font-archivo relative flex h-[17px] w-[17px] items-center justify-center rounded-full border-2 border-[var(--color-header)] bg-[var(--color-danger-strong)] text-[10px] font-bold leading-none text-white">
              {badge}
            </span>
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-[376px] max-w-[90vw] overflow-hidden rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[var(--shadow-bell)] [animation:rosterFade_0.15s_ease]"
        >
          <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-4 py-3">
            <span className="font-archivo text-sm font-bold">
              Notifications
            </span>
            {unreadCount > 0 ? (
              <form action={markAllNotificationsReadAction}>
                <button
                  type="submit"
                  className="text-xs font-medium text-[var(--color-brand)] underline underline-offset-2"
                >
                  Mark all as read
                </button>
              </form>
            ) : null}
          </div>

          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-[var(--color-text-secondary)]">
              You&rsquo;re all caught up.
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((n) => {
                const chip = TYPE_ICONS[n.type] ?? FALLBACK_ICON;
                return (
                  <li
                    key={n.id}
                    className="border-b border-[var(--color-border-subtle)] last:border-b-0"
                  >
                    <form action={openNotificationAction}>
                      <input type="hidden" name="id" value={n.id} />
                      <input
                        type="hidden"
                        name="linkPath"
                        value={n.linkPath ?? "/app"}
                      />
                      <button
                        type="submit"
                        role="menuitem"
                        className={`block w-full px-4 py-3 text-left hover:bg-[var(--color-bg)] ${
                          n.isRead
                            ? ""
                            : "border-l-[3px] border-[var(--color-accent)] bg-[var(--color-accent-faint)]/40"
                        }`}
                      >
                        <span className="flex items-start gap-3">
                          <span
                            aria-hidden="true"
                            className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-[9px]"
                            style={{ backgroundColor: chip.bg, color: chip.fg }}
                          >
                            <span className="material-symbols-rounded text-[18px]">
                              {chip.icon}
                            </span>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold">
                              {n.title}
                            </span>
                            {n.body ? (
                              <span className="block truncate text-sm text-[var(--color-text-secondary)]">
                                {n.body}
                              </span>
                            ) : null}
                            <span className="block text-xs text-[var(--color-text-muted)]">
                              {n.timeText}
                            </span>
                          </span>
                        </span>
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="border-t border-[var(--color-border-subtle)] px-3 py-2 text-center">
            <Link
              href="/app/notifications"
              className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
              onClick={() => setOpen(false)}
            >
              View all
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
