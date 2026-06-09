import Link from "next/link";
import { ownerRepo } from "@/lib/auth/context";
import { signOut } from "@/lib/auth";
import { OwnerNav } from "@/components/OwnerNav";
import { NotificationBell } from "@/components/NotificationBell";
import { relativeTime } from "@/lib/notifications";

export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Tenant-scoped via the session. The unread count + recent list are read per
  // request (owner pages are dynamic), so they refresh on navigation/refresh.
  const repo = await ownerRepo();
  const [unreadCount, recent] = await Promise.all([
    repo.countUnreadNotifications(),
    repo.listRecentNotifications(10),
  ]);
  const now = new Date();
  const bellItems = recent.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    linkPath: n.linkPath,
    timeText: relativeTime(n.createdAt, now),
    isRead: n.isRead,
  }));

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <div className="min-h-screen">
      <header className="bg-[var(--color-header-bg)] text-[var(--color-header-ink)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-3">
          <Link
            href="/app"
            className="text-lg font-extrabold tracking-tight text-[var(--color-header-ink)]"
          >
            Zale<span className="text-[var(--color-accent)]">IT</span>
          </Link>
          <div className="flex items-center gap-2">
            <NotificationBell unreadCount={unreadCount} items={bellItems} />
            <form action={doSignOut}>
              <button
                type="submit"
                className="rounded-md px-2 py-1 text-sm font-medium text-[var(--color-header-muted)] underline underline-offset-2 hover:text-[var(--color-header-ink)]"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
        <OwnerNav />
      </header>
      <main id="main" className="mx-auto max-w-3xl px-5 py-8">
        {children}
      </main>
    </div>
  );
}
