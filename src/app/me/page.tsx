import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { createTenantRepo } from "@/lib/tenant/repository";
import { resolveNoticesStaff } from "@/lib/tenant/notices-access";
import { NOTICES_COOKIE, NOTICES_VERIFIED_COOKIE } from "@/lib/kiosk-cookie";
import { checkNoticesVerification } from "@/lib/notices-verification";
import { relativeTime } from "@/lib/notifications";
import { Card } from "@/components/ui";
import { NoticesPinForm } from "@/components/NoticesPinForm";
import {
  noticesPinAction,
  markNoticeReadAction,
  markAllNoticesReadAction,
} from "@/app/me/actions";

export const dynamic = "force-dynamic";

/**
 * A staff member's PRIVATE notices page. The capability cookie (set by
 * /me/<token>) identifies exactly ONE staff member; their PIN — proved by the
 * short-lived signed cookie — gates everything personal. All reads are scoped
 * to that one person's notices; there is no path from here into /app or any
 * other staff member's data.
 */
export default async function NoticesPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(NOTICES_COOKIE)?.value ?? "";
  const resolved = await resolveNoticesStaff(token);

  if (!resolved) {
    return (
      <Card className="mt-8 text-center">
        <h1 className="text-xl font-bold">Link not active</h1>
        <p className="mt-2 text-[var(--color-muted)]">
          This link is no longer active. Ask your manager for your current
          notices link.
        </p>
      </Card>
    );
  }

  const verified = checkNoticesVerification(
    cookieStore.get(NOTICES_VERIFIED_COOKIE)?.value,
    resolved.staffMemberId,
    env.AUTH_SECRET,
  );

  if (!verified) {
    return (
      <NoticesPinForm
        action={noticesPinAction}
        staffName={resolved.staffName}
        businessName={resolved.businessName}
      />
    );
  }

  const repo = createTenantRepo(resolved.businessId);
  const notices = await repo.listStaffNotifications(resolved.staffMemberId);
  const unreadCount = notices.filter((n) => !n.isRead).length;
  const now = new Date();

  return (
    <>
      <header className="mb-4">
        <h1 className="text-2xl font-bold">
          {resolved.staffName}&apos;s notices
        </h1>
        <p className="mt-1 text-[var(--color-muted)]">
          From {resolved.businessName}. Only you can see this page.
        </p>
      </header>

      {unreadCount > 0 ? (
        <form action={markAllNoticesReadAction} className="mb-3 text-right">
          <button
            type="submit"
            className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
          >
            Mark all as read
          </button>
        </form>
      ) : null}

      {notices.length === 0 ? (
        <Card className="text-center text-[var(--color-muted)]">
          Nothing yet. Roster updates, leave decisions and shift reminders will
          show up here.
        </Card>
      ) : (
        <ul className="space-y-2">
          {notices.map((n) => (
            <li key={n.id}>
              <Card
                className={`py-3 ${n.isRead ? "" : "border-[var(--color-brand)]"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p
                      className={
                        n.isRead
                          ? "font-medium text-[var(--color-muted)]"
                          : "font-semibold"
                      }
                    >
                      {!n.isRead ? (
                        <span
                          aria-hidden="true"
                          className="mr-2 inline-block h-2 w-2 rounded-full bg-[var(--color-brand)] align-middle"
                        />
                      ) : null}
                      {n.title}
                      {!n.isRead ? <span className="sr-only"> (new)</span> : null}
                    </p>
                    {n.body ? (
                      <p className="mt-0.5 text-sm text-[var(--color-muted)]">
                        {n.body}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-[var(--color-muted)]">
                      {relativeTime(n.createdAt, now)}
                    </p>
                  </div>
                  {!n.isRead ? (
                    <form action={markNoticeReadAction}>
                      <input type="hidden" name="id" value={n.id} />
                      <button
                        type="submit"
                        className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
                        aria-label={`Mark "${n.title}" as read`}
                      >
                        Mark read
                      </button>
                    </form>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
