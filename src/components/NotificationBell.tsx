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
  title: string;
  body: string | null;
  linkPath: string | null;
  timeText: string;
  isRead: boolean;
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
        className="relative flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 py-1 text-[var(--color-header-ink)] hover:bg-white/10"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 1 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 ? (
          <span
            aria-hidden="true"
            className="absolute right-0.5 top-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--color-accent)] px-1 text-xs font-bold leading-5 text-black"
          >
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-80 max-w-[90vw] overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-[var(--color-line)] px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
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
            <p className="px-3 py-6 text-center text-sm text-[var(--color-muted)]">
              You&rsquo;re all caught up.
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((n) => (
                <li
                  key={n.id}
                  className="border-b border-[var(--color-line)] last:border-b-0"
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
                      className={`block w-full px-3 py-3 text-left hover:bg-[var(--color-canvas)] ${
                        n.isRead ? "" : "bg-[var(--color-canvas)]/60"
                      }`}
                    >
                      <span className="flex items-start gap-2">
                        {!n.isRead ? (
                          <span
                            aria-hidden="true"
                            className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-[var(--color-brand)]"
                          />
                        ) : (
                          <span className="mt-1.5 h-2 w-2 flex-shrink-0" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">
                            {n.title}
                          </span>
                          {n.body ? (
                            <span className="block truncate text-sm text-[var(--color-muted)]">
                              {n.body}
                            </span>
                          ) : null}
                          <span className="block text-xs text-[var(--color-muted)]">
                            {n.timeText}
                          </span>
                        </span>
                      </span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-[var(--color-line)] px-3 py-2 text-center">
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
