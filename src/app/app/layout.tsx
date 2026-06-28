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
  const [unreadCount, recent, business] = await Promise.all([
    repo.countUnreadNotifications(),
    repo.listRecentNotifications(10),
    repo.getBusiness(),
  ]);
  const now = new Date();
  const bellItems = recent.map((n) => ({
    id: n.id,
    type: n.type,
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
      <header className="bg-[var(--color-header)] text-[var(--color-header-ink)]">
        <div className="mx-auto flex h-[60px] max-w-3xl items-center justify-between gap-4 px-5">
          <div className="flex items-center gap-3">
            <Link
              href="/app"
              className="flex items-center gap-2.5 text-[var(--color-header-ink)]"
            >
              <span
                aria-hidden="true"
                className="flex h-[26px] w-[26px] items-center justify-center rounded-md bg-[var(--color-accent)] text-[var(--color-header)]"
              >
                <span className="material-symbols-rounded text-[18px]">
                  grid_view
                </span>
              </span>
              <span className="font-archivo text-[18px] font-extrabold tracking-[0.05em]">
                Zale<span className="text-[var(--color-accent)]">IT</span>
              </span>
            </Link>
            {business?.name ? (
              <span className="hidden border-l border-[#374151] pl-[13px] text-[12.5px] text-[var(--color-text-muted)] sm:inline">
                {business.name}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell unreadCount={unreadCount} items={bellItems} />
            <form action={doSignOut}>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-[9px] border border-[#374151] px-3 py-2 text-sm font-medium text-[#D1D5DB] hover:bg-[var(--color-header-hover)]"
              >
                <span
                  aria-hidden="true"
                  className="material-symbols-rounded text-[18px]"
                >
                  logout
                </span>
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
