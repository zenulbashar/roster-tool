import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { createTenantRepo } from "@/lib/tenant/repository";
import { resolveNoticesStaff } from "@/lib/tenant/notices-access";
import { NOTICES_COOKIE, NOTICES_VERIFIED_COOKIE } from "@/lib/kiosk-cookie";
import { checkNoticesVerification } from "@/lib/notices-verification";
import { relativeTime } from "@/lib/notifications";
import { StaffHeader } from "@/components/StaffHeader";
import { NoticesPinForm } from "@/components/NoticesPinForm";
import {
  noticesPinAction,
  markNoticeReadAction,
  markAllNoticesReadAction,
} from "@/app/me/actions";

export const dynamic = "force-dynamic";

/** Per-notice-type icon chip (mirrors the owner bell's visual language). */
const NOTICE_ICONS: Record<string, { icon: string; bg: string; fg: string }> = {
  leave_decided: { icon: "check_circle", bg: "#ECFDF3", fg: "#16A34A" },
  shift_swap_approved: { icon: "swap_horiz", bg: "#ECFDF3", fg: "#16A34A" },
  rostered: { icon: "event", bg: "#EFF6FF", fg: "#2563EB" },
  shift_reminder: { icon: "alarm", bg: "#FEF3E2", fg: "#D97706" },
};
const FALLBACK = { icon: "notifications", bg: "#F3F4F6", fg: "#6B7280" };

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
      <div className="mx-auto mt-10 max-w-[420px] rounded-[16px] border border-[var(--color-border)] bg-white p-7 text-center shadow-[var(--shadow-card)]">
        <h1 className="font-archivo text-[20px] font-extrabold text-[var(--color-ink)]">
          Link not active
        </h1>
        <p className="mt-2 text-[var(--color-text-secondary)]">
          This link is no longer active. Ask your manager for your current
          notices link.
        </p>
      </div>
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
  const [notices, internalForms] = await Promise.all([
    repo.listStaffNotifications(resolved.staffMemberId),
    repo.listInternalFormsForStaff(resolved.staffMemberId),
  ]);
  const unreadCount = notices.filter((n) => !n.isRead).length;
  const now = new Date();

  return (
    <>
      <StaffHeader
        businessName={resolved.businessName}
        title={`${resolved.staffName}'s notices`}
        subtitle="Roster updates, leave decisions and reminders — only you can see this page."
      />

      {internalForms.length > 0 ? (
        <section className="mb-6" aria-label="Forms to fill">
          <h2 className="mb-2 font-archivo text-[15px] font-bold text-[var(--color-ink)]">
            Forms to fill
          </h2>
          <ul className="space-y-2">
            {internalForms.map((f) => {
              // alreadyResponded is meaningful for attributed forms only; an
              // anonymous form is always fillable (no per-person record exists).
              const done = !f.allowAnonymous && f.alreadyResponded;
              return (
                <li key={f.id}>
                  <div className="flex items-start justify-between gap-3 rounded-[14px] border border-[var(--color-border)] bg-white p-4 shadow-[var(--shadow-card)]">
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--color-ink)]">
                        {f.title}
                      </p>
                      {f.description ? (
                        <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">
                          {f.description}
                        </p>
                      ) : null}
                      <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                        <span className="material-symbols-rounded text-[14px]">
                          {f.allowAnonymous ? "visibility_off" : "badge"}
                        </span>
                        {f.allowAnonymous
                          ? "Anonymous"
                          : "Your name is recorded"}
                      </p>
                    </div>
                    {done ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-[6px] bg-[#ECFDF3] px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-[#15803D]">
                        Done
                      </span>
                    ) : (
                      <a
                        href={`/me/forms/${f.id}`}
                        className="inline-flex shrink-0 items-center gap-1 rounded-[9px] bg-[var(--color-button)] px-3.5 py-2 font-archivo text-[13px] font-bold text-[var(--color-button-ink)] hover:bg-[var(--color-accent-dark)]"
                      >
                        Fill in
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-archivo text-[15px] font-bold text-[var(--color-ink)]">
          Notices
        </h2>
        {unreadCount > 0 ? (
          <form action={markAllNoticesReadAction}>
            <button
              type="submit"
              className="text-[12.5px] font-semibold text-[#4D7C0F] hover:underline"
            >
              Mark all read
            </button>
          </form>
        ) : null}
      </div>

      {notices.length === 0 ? (
        <div className="rounded-[14px] border border-[var(--color-border)] bg-white p-6 text-center text-[var(--color-text-secondary)] shadow-[var(--shadow-card)]">
          Nothing yet. Roster updates, leave decisions and shift reminders will
          show up here.
        </div>
      ) : (
        <ul className="space-y-2">
          {notices.map((n) => {
            const chip = NOTICE_ICONS[n.type] ?? FALLBACK;
            return (
              <li key={n.id}>
                <div
                  className={`flex items-start gap-3 rounded-[14px] border bg-white p-4 shadow-[var(--shadow-card)] ${
                    n.isRead
                      ? "border-[var(--color-border)] opacity-[.7]"
                      : "border-l-[3px] border-[var(--color-border)]"
                  }`}
                  style={n.isRead ? undefined : { borderLeftColor: chip.fg }}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[10px]"
                    style={{ backgroundColor: chip.bg, color: chip.fg }}
                  >
                    <span className="material-symbols-rounded text-[20px]">
                      {chip.icon}
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-[var(--color-ink)]">
                      {n.title}
                      {!n.isRead ? (
                        <span className="sr-only"> (new)</span>
                      ) : null}
                    </p>
                    {n.body ? (
                      <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">
                        {n.body}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {relativeTime(n.createdAt, now)}
                    </p>
                  </div>
                  {!n.isRead ? (
                    <form action={markNoticeReadAction}>
                      <input type="hidden" name="id" value={n.id} />
                      <button
                        type="submit"
                        className="whitespace-nowrap text-[12.5px] font-semibold text-[#4D7C0F] hover:underline"
                        aria-label={`Mark "${n.title}" as read`}
                      >
                        Mark read
                      </button>
                    </form>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
