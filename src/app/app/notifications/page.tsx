import { ownerRepo } from "@/lib/auth/context";
import { relativeTime } from "@/lib/notifications";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import {
  openNotificationAction,
  markAllNotificationsReadAction,
} from "./actions";

/**
 * Per-type icon chip (Material Symbols Rounded), mirroring the header bell's
 * visual language. Purely decorative — colours are token-backed; unknown types
 * fall back to a neutral bell.
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

/**
 * Full owner notification list (reached from the header bell's "View all").
 * Read-only over the tenant-scoped notification rows; each row marks itself read
 * and navigates on click, with a "Mark all as read" action. Not in OwnerNav.
 */
export default async function NotificationsPage() {
  const repo = await ownerRepo();
  const [unreadCount, items] = await Promise.all([
    repo.countUnreadNotifications(),
    repo.listRecentNotifications(50),
  ]);
  const now = new Date();

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Notifications"
          subtitle="Activity from your team — leave, shifts, stock, certifications and availability."
        />
        {unreadCount > 0 ? (
          <form action={markAllNotificationsReadAction} className="mt-1">
            <button
              type="submit"
              className="text-[12.5px] font-semibold text-[#4D7C0F] hover:underline"
            >
              Mark all read ({unreadCount})
            </button>
          </form>
        ) : null}
      </div>

      {items.length === 0 ? (
        <Card className="mt-4">
          <EmptyState icon="notifications" title="You're all caught up">
            New activity from your team will show up here.
          </EmptyState>
        </Card>
      ) : (
        <Card className="mt-4 overflow-hidden p-0">
          <ul>
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
                      style={
                        n.isRead ? undefined : { borderLeftColor: chip.fg }
                      }
                      className={`block w-full border-l-[3px] px-4 py-[13px] text-left hover:bg-[var(--color-bg)] ${
                        n.isRead
                          ? "border-transparent opacity-[.62]"
                          : "bg-white"
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
                          <span className="block text-[13px] font-bold text-[#111827]">
                            {n.title}
                          </span>
                          {n.body ? (
                            <span className="mt-px block text-[12.5px] leading-[1.35] text-[#4B5563]">
                              {n.body}
                            </span>
                          ) : null}
                          <span className="mt-[3px] block text-[11px] text-[#9CA3AF]">
                            {relativeTime(n.createdAt, now)}
                          </span>
                        </span>
                      </span>
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
