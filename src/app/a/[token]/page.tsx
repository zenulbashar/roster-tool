import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { findRequestByToken } from "@/lib/tenant/public-access";
import { createTenantRepo } from "@/lib/tenant/repository";
import { formatDateOnly, formatTimeOnly, formatDateTime } from "@/lib/time";
import { resolveShiftColors } from "@/lib/shift-colors";
import { notifyOwner } from "@/lib/notifications";
import { Banner } from "@/components/ui";
import { StaffHeader } from "@/components/StaffHeader";

export const dynamic = "force-dynamic";

function LinkError({ children }: { children?: React.ReactNode }) {
  return (
    <main id="main" className="mx-auto max-w-md px-5 py-16">
      <div className="rounded-[16px] border border-[var(--color-border)] bg-white p-7 text-center shadow-[var(--shadow-card)]">
        <h1 className="font-archivo text-[20px] font-extrabold text-[var(--color-ink)]">
          This link isn&rsquo;t working
        </h1>
        {children}
      </div>
    </main>
  );
}

export default async function AvailabilityPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { token } = await params;
  const { saved } = await searchParams;

  const request = await findRequestByToken(token);
  if (!request) {
    return (
      <LinkError>
        <p className="mt-2 text-[var(--color-text-secondary)]">
          It may have expired or already been used. Please ask your manager to
          send you a new one.
        </p>
      </LinkError>
    );
  }

  const repo = createTenantRepo(request.businessId);
  const [period, shifts, staff, existing, templates, [business]] =
    await Promise.all([
      repo.getPeriod(request.rosterPeriodId),
      repo.listShifts(request.rosterPeriodId),
      repo.getStaff(request.staffMemberId),
      repo.responsesForRequest(request.id),
      repo.listTemplates(),
      db
        .select({ name: businesses.name, timezone: businesses.timezone })
        .from(businesses)
        .where(eq(businesses.id, request.businessId))
        .limit(1),
    ]);

  if (!period || !staff || !business) {
    return <LinkError />;
  }

  // Each shift's colour comes from its type's chosen colour (by templateId),
  // falling back to the keyword scheme from the label.
  const colorByTemplateId = new Map(templates.map((t) => [t.id, t.color]));
  const schemeForShift = (s: { templateId: string | null; label: string }) =>
    resolveShiftColors(
      s.templateId ? (colorByTemplateId.get(s.templateId) ?? null) : null,
      s.label,
    );

  // Prefill from any prior answers; default to "Available" to minimise taps.
  const priorById = new Map(existing.map((e) => [e.shiftId, e.available]));

  const byDay = new Map<string, typeof shifts>();
  for (const s of shifts) {
    const list = byDay.get(s.date) ?? [];
    list.push(s);
    byDay.set(s.date, list);
  }

  async function submit(formData: FormData) {
    "use server";
    // Re-resolve from the token: it, not any form field, is the authority.
    const req = await findRequestByToken(token);
    if (!req) redirect(`/a/${token}`);

    const repo = createTenantRepo(req.businessId);
    const periodShifts = await repo.listShifts(req.rosterPeriodId);
    const entries = periodShifts.map((s) => ({
      shiftId: s.id,
      available: formData.get(`shift_${s.id}`) !== "no",
    }));

    await repo.saveResponses(req.id, entries);
    await repo.markRequestResponded(req.id);

    // Best-effort owner notification that this person has replied.
    const [staff, period] = await Promise.all([
      repo.getStaff(req.staffMemberId),
      repo.getPeriod(req.rosterPeriodId),
    ]);
    await notifyOwner(repo, {
      type: "availability_reply",
      title: `${staff?.name ?? "A staff member"} sent their availability`,
      body: period ? period.label : null,
      linkPath: `/app/periods/${req.rosterPeriodId}`,
    });

    revalidatePath(`/a/${token}`);
    redirect(`/a/${token}?saved=1`);
  }

  const deadlineText = period.availabilityDeadline
    ? formatDateTime(period.availabilityDeadline, business.timezone)
    : null;

  return (
    <main id="main" className="mx-auto max-w-xl px-5 py-10">
      <StaffHeader
        businessName={business.name}
        eyebrow="Your availability"
        title={`Hi ${staff.name.split(" ")[0]}, when can you work?`}
        subtitle={`Roster: ${period.label}. Tap the shifts you can't do — everything starts as "I can work".${deadlineText ? ` Please reply by ${deadlineText}.` : ""}`}
      />

      {saved ? (
        <div className="mb-4">
          <Banner tone="success">
            Thanks! Your availability has been saved. You can change it any time
            using this link.
          </Banner>
        </div>
      ) : null}

      <form action={submit} className="space-y-4">
        {[...byDay.entries()].map(([date, dayShifts]) => (
          <div
            key={date}
            className="overflow-hidden rounded-[14px] border border-[var(--color-border)] bg-white shadow-[var(--shadow-card)]"
          >
            <div className="border-b border-[var(--color-border-subtle)] bg-[#FAFBFC] px-4 py-3 font-archivo text-[15px] font-bold text-[var(--color-ink)]">
              {formatDateOnly(date)}
            </div>
            <ul className="divide-y divide-[var(--color-border-subtle)]">
              {dayShifts.map((s) => {
                const prior = priorById.get(s.id);
                const cantSelected = prior === false;
                const scheme = schemeForShift(s);
                return (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <span className="flex items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="h-[10px] w-[10px] flex-shrink-0 rounded-full"
                        style={{ backgroundColor: scheme.bar }}
                      />
                      <span>
                        <span className="font-archivo text-[14px] font-bold text-[var(--color-ink)]">
                          {s.label}
                        </span>{" "}
                        <span className="text-[12.5px] text-[var(--color-text-secondary)]">
                          {formatTimeOnly(s.startTime)} –{" "}
                          {formatTimeOnly(s.endTime)}
                        </span>
                      </span>
                    </span>
                    <span
                      className="inline-flex overflow-hidden rounded-[10px] border border-[var(--color-border)]"
                      role="group"
                      aria-label={`${s.label} ${formatDateOnly(date)}`}
                    >
                      <label className="cursor-pointer px-3.5 py-2 text-[13px] font-semibold text-[var(--color-text-secondary)] has-[:checked]:bg-[#16A34A] has-[:checked]:text-white has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-[var(--color-brand)]">
                        <input
                          type="radio"
                          name={`shift_${s.id}`}
                          value="yes"
                          defaultChecked={!cantSelected}
                          className="sr-only"
                        />
                        I can work
                      </label>
                      <label className="cursor-pointer border-l border-[var(--color-border)] px-3.5 py-2 text-[13px] font-semibold text-[var(--color-text-secondary)] has-[:checked]:bg-[#B91C1C] has-[:checked]:text-white has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-[var(--color-brand)]">
                        <input
                          type="radio"
                          name={`shift_${s.id}`}
                          value="no"
                          defaultChecked={cantSelected}
                          className="sr-only"
                        />
                        Can&rsquo;t
                      </label>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {shifts.length === 0 ? (
          <div className="rounded-[14px] border border-[var(--color-border)] bg-white p-6 text-center text-[var(--color-text-secondary)] shadow-[var(--shadow-card)]">
            There are no shifts to choose yet. Please check back later.
          </div>
        ) : (
          <button
            type="submit"
            className="w-full rounded-[14px] bg-[var(--color-button)] py-3.5 font-archivo text-[15px] font-bold text-[var(--color-button-ink)] hover:bg-[var(--color-accent-dark)]"
          >
            Save my availability
          </button>
        )}
      </form>
    </main>
  );
}
