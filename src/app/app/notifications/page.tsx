import { ownerRepo } from "@/lib/auth/context";
import { relativeTime } from "@/lib/notifications";
import { PageHeader, Card } from "@/components/ui";
import {
  openNotificationAction,
  markAllNotificationsReadAction,
} from "./actions";

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
      <PageHeader
        title="Notifications"
        subtitle="Activity from your team — leave, shifts, stock, certifications and availability."
      />

      {unreadCount > 0 ? (
        <form action={markAllNotificationsReadAction} className="mt-2">
          <button
            type="submit"
            className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
          >
            Mark all as read ({unreadCount})
          </button>
        </form>
      ) : null}

      {items.length === 0 ? (
        <Card className="mt-4 text-center text-[var(--color-muted)]">
          You&rsquo;re all caught up.
        </Card>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map((n) => (
            <li key={n.id}>
              <form action={openNotificationAction}>
                <input type="hidden" name="id" value={n.id} />
                <input
                  type="hidden"
                  name="linkPath"
                  value={n.linkPath ?? "/app"}
                />
                <button
                  type="submit"
                  className={`block w-full rounded-lg border border-[var(--color-line)] px-4 py-3 text-left hover:border-[var(--color-brand)] ${
                    n.isRead
                      ? "bg-[var(--color-surface)]"
                      : "bg-[var(--color-canvas)]"
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
                      <span className="block font-medium">{n.title}</span>
                      {n.body ? (
                        <span className="block text-sm text-[var(--color-muted)]">
                          {n.body}
                        </span>
                      ) : null}
                      <span className="block text-xs text-[var(--color-muted)]">
                        {relativeTime(n.createdAt, now)}
                      </span>
                    </span>
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
