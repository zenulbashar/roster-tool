import Link from "next/link";
import { ownerContext } from "@/lib/auth/context";
import { signOut } from "@/lib/auth";
import { OwnerNav } from "@/components/OwnerNav";
import { LocationSwitcher } from "@/components/LocationSwitcher";
import { NotificationBell } from "@/components/NotificationBell";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import { ImpersonationWriteGuard } from "@/components/ImpersonationWriteGuard";
import { relativeTime } from "@/lib/notifications";

export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Tenant-scoped via the session. The unread count + recent list are read per
  // request (owner pages are dynamic), so they refresh on navigation/refresh.
  // The org's locations feed the header location switcher (M29).
  const { repo, org, businessId, impersonation } = await ownerContext();
  const [unreadCount, recent, locations] = await Promise.all([
    repo.countUnreadNotifications(),
    repo.listRecentNotifications(10),
    org.listLocations(),
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

  const impersonating = impersonation !== null;

  return (
    <div
      className={`min-h-screen bg-[var(--color-bg)] ${impersonating ? "pt-[52px]" : ""}`}
    >
      {/* M37: an admin acting inside this tenant gets a persistent red banner, a
          full-viewport inset frame, and a write-confirm guard over page writes. */}
      {impersonating ? (
        <>
          <ImpersonationBanner venueName={impersonation.venueName} />
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 z-[55] border-4 border-[#DC2626]"
          />
          <ImpersonationWriteGuard venueName={impersonation.venueName} />
        </>
      ) : null}
      {/* Dark top nav — the real global chrome (single 60px row). */}
      <header
        className={`sticky ${impersonating ? "top-[52px]" : "top-0"} z-50 bg-[var(--color-header)] shadow-[0_1px_0_#1F2937]`}
      >
        <div className="flex h-[60px] items-center gap-0 pl-5 pr-4">
          <Link
            href="/app"
            className="mr-1.5 flex items-center gap-2.5"
            aria-label="Roster home"
          >
            <span
              aria-hidden="true"
              className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-[var(--color-accent)] text-[var(--color-header)]"
            >
              <span className="material-symbols-rounded text-[17px]">
                grid_view
              </span>
            </span>
            <span className="font-archivo text-[18px] font-extrabold tracking-[0.05em] text-[var(--color-accent)]">
              ROSTER
            </span>
          </Link>
          <LocationSwitcher
            activeId={businessId}
            locations={locations.map((l) => ({ id: l.id, name: l.name }))}
          />

          <OwnerNav />

          <div className="flex-1" />

          <div className="flex items-center gap-1.5">
            <NotificationBell unreadCount={unreadCount} items={bellItems} />
            <form action={doSignOut}>
              <button
                type="submit"
                className="ml-1 flex items-center gap-1.5 rounded-[9px] border border-[#374151] px-[13px] py-2 text-[12.5px] font-semibold text-[#D1D5DB] transition-colors hover:bg-[var(--color-header-hover)] hover:text-white"
              >
                <span
                  aria-hidden="true"
                  className="material-symbols-rounded text-[17px]"
                >
                  logout
                </span>
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      <main
        id="main"
        className="mx-auto max-w-[1340px] px-[30px] pb-20 pt-[26px] max-sm:px-4"
      >
        {children}
      </main>
    </div>
  );
}
