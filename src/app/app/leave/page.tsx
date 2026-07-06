import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ownerRepo } from "@/lib/auth/context";
import { enqueueLeaveDecision } from "@/lib/jobs/boss";
import { notifyStaff } from "@/lib/staff-notifications";
import { leaveRequestSchema } from "@/lib/validation";
import { leaveTypeLabel } from "@/lib/labels";
import { businessDateOf, formatDateRange } from "@/lib/time";
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  Field,
  Icon,
  PageHeader,
  TextInput,
} from "@/components/ui";

const PATH = "/app/leave";

const LEAVE_TYPES = [
  { value: "annual", label: "Annual leave" },
  { value: "sick", label: "Sick leave" },
  { value: "unpaid", label: "Unpaid leave" },
  { value: "other", label: "Other" },
] as const;

/** Inclusive day count between two YYYY-MM-DD calendar dates, for display. */
function dayCount(start: string, end: string): string {
  const a = new Date(`${start}T00:00:00Z`).getTime();
  const b = new Date(`${end}T00:00:00Z`).getTime();
  const days = Math.round((b - a) / 86_400_000) + 1;
  return `${days} day${days === 1 ? "" : "s"}`;
}

export default async function LeavePage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    approved?: string;
    denied?: string;
    added?: string;
    deleted?: string;
  }>;
}) {
  const sp = await searchParams;
  const repo = await ownerRepo();
  const business = await repo.getBusiness();
  const today = businessDateOf(new Date(), business?.timezone);

  const [pending, upcoming, staff] = await Promise.all([
    repo.listLeaveByStatus("pending"),
    repo.listUpcomingApprovedLeave(today),
    repo.listStaff({ activeOnly: true }),
  ]);

  async function approveLeave(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    const decided = await repo.decideLeaveRequest(id, "approved");
    if (decided) {
      await enqueueLeaveDecision({ leaveRequestId: id });
      // In-app notice for the requester, in addition to the decision email.
      await notifyStaff(repo, {
        staffMemberId: decided.staffMemberId,
        type: "leave_decided",
        title: "Your leave was approved",
        body: `${leaveTypeLabel(decided.leaveType)} · ${formatDateRange(decided.startDate, decided.endDate)}`,
      });
    }
    revalidatePath(PATH);
    redirect(`${PATH}?approved=1`);
  }

  async function denyLeave(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    const decided = await repo.decideLeaveRequest(id, "denied");
    if (decided) {
      await enqueueLeaveDecision({ leaveRequestId: id });
      await notifyStaff(repo, {
        staffMemberId: decided.staffMemberId,
        type: "leave_decided",
        title: "Your leave request was declined",
        body: `${leaveTypeLabel(decided.leaveType)} · ${formatDateRange(decided.startDate, decided.endDate)}`,
      });
    }
    revalidatePath(PATH);
    redirect(`${PATH}?denied=1`);
  }

  async function addLeaveDirect(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const staffMemberId = String(formData.get("staffMemberId"));
    const parsed = leaveRequestSchema.safeParse({
      leaveType: formData.get("leaveType"),
      startDate: formData.get("startDate"),
      endDate: formData.get("endDate"),
      note: formData.get("note") ?? "",
    });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Please check the form";
      redirect(`${PATH}?error=${encodeURIComponent(msg)}`);
    }
    const { leaveType, startDate, endDate, note } = parsed.data;
    // Owner direct-entry is recorded as already approved (the "they told me
    // verbally" case) and sends NO email.
    const created = await repo.createLeaveRequest({
      staffMemberId,
      leaveType,
      startDate,
      endDate,
      note: note && note.length > 0 ? note : null,
      status: "approved",
      decidedAt: new Date(),
    });
    if (!created)
      redirect(`${PATH}?error=${encodeURIComponent("Pick a team member")}`);
    revalidatePath(PATH);
    redirect(`${PATH}?added=1`);
  }

  async function deleteLeave(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    await repo.deleteLeaveRequest(id);
    revalidatePath(PATH);
    redirect(`${PATH}?deleted=1`);
  }

  const hasRows = pending.length > 0 || upcoming.length > 0;

  return (
    <>
      <PageHeader
        title="Leave requests"
        subtitle="Approve or deny — staff get notified instantly and the roster updates."
      />

      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}
      {sp.approved ? <Banner tone="success">Leave approved.</Banner> : null}
      {sp.denied ? <Banner tone="success">Leave declined.</Banner> : null}
      {sp.added ? <Banner tone="success">Leave recorded.</Banner> : null}
      {sp.deleted ? <Banner tone="success">Leave removed.</Banner> : null}

      <div className="mt-1">
        <Banner tone="info">
          Leave is recorded for scheduling purposes. Balances and accruals are
          managed by your payroll provider.
        </Banner>
      </div>

      <Card padded={false} className="mt-4">
        {!hasRows ? (
          <p className="px-5 py-6 text-[13px] text-[#6B7280]">
            No leave to show. New requests from your team appear here, and any
            leave you record shows up below.
          </p>
        ) : (
          <ul>
            {pending.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-[15px] border-b border-[#F3F4F6] px-5 py-[15px] last:border-b-0"
              >
                <div className="flex min-w-[180px] items-center gap-[11px]">
                  <Avatar name={r.staffName} colorKey={r.staffName} size={36} />
                  <div>
                    <div className="font-archivo text-[14px] font-bold text-[#111827]">
                      {r.staffName}
                    </div>
                    <div className="text-[12px] text-[#6B7280]">
                      {leaveTypeLabel(r.leaveType)}
                    </div>
                  </div>
                </div>
                <div className="min-w-[130px]">
                  <div className="font-archivo text-[13.5px] font-semibold text-[#111827]">
                    {formatDateRange(r.startDate, r.endDate)}
                  </div>
                  <div className="text-[12px] text-[#9CA3AF]">
                    {dayCount(r.startDate, r.endDate)}
                  </div>
                </div>
                <div className="min-w-[120px] flex-1 text-[12.5px] text-[#6B7280]">
                  {r.note ? `“${r.note}”` : null}
                </div>
                <div className="flex items-center gap-2">
                  <form action={denyLeave}>
                    <input type="hidden" name="id" value={r.id} />
                    <Button
                      type="submit"
                      variant="secondary"
                      className="gap-1 border-[#FECACA] text-[#B91C1C] hover:bg-[#FEF2F2] hover:border-[#FECACA]"
                    >
                      <Icon name="close" className="text-[16px]" />
                      Deny
                    </Button>
                  </form>
                  <form action={approveLeave}>
                    <input type="hidden" name="id" value={r.id} />
                    <Button type="submit" className="gap-1">
                      <Icon name="check" className="text-[16px]" />
                      Approve
                    </Button>
                  </form>
                </div>
              </li>
            ))}
            {upcoming.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-[15px] border-b border-[#F3F4F6] px-5 py-[15px] last:border-b-0"
              >
                <div className="flex min-w-[180px] items-center gap-[11px]">
                  <Avatar name={r.staffName} colorKey={r.staffName} size={36} />
                  <div>
                    <div className="font-archivo text-[14px] font-bold text-[#111827]">
                      {r.staffName}
                    </div>
                    <div className="text-[12px] text-[#6B7280]">
                      {leaveTypeLabel(r.leaveType)}
                    </div>
                  </div>
                </div>
                <div className="min-w-[130px]">
                  <div className="font-archivo text-[13.5px] font-semibold text-[#111827]">
                    {formatDateRange(r.startDate, r.endDate)}
                  </div>
                  <div className="text-[12px] text-[#9CA3AF]">
                    {dayCount(r.startDate, r.endDate)}
                  </div>
                </div>
                <div className="min-w-[120px] flex-1 text-[12.5px] text-[#6B7280]">
                  {r.note ? `“${r.note}”` : null}
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone="success">Approved</Badge>
                  <form action={deleteLeave}>
                    <input type="hidden" name="id" value={r.id} />
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#B91C1C] underline-offset-2 hover:underline"
                    >
                      Remove
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-6">
        <h2 className="font-archivo text-[17px] font-bold text-[#111827]">
          Record leave
        </h2>
        <p className="mt-1 text-[13px] text-[#6B7280]">
          Add leave a team member told you about. It&rsquo;s saved as approved
          straight away (no email is sent).
        </p>
        {staff.length === 0 ? (
          <p className="mt-3 text-[13px] text-[#6B7280]">
            Add a team member first.
          </p>
        ) : (
          <form action={addLeaveDirect} className="mt-4 space-y-4">
            <Field label="Team member">
              <select
                name="staffMemberId"
                required
                aria-label="Team member"
                className="block w-full rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-[14px] py-[11px] text-[14.5px] text-[var(--color-ink)]"
              >
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Type">
              <select
                name="leaveType"
                defaultValue="annual"
                aria-label="Leave type"
                className="block w-full rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-[14px] py-[11px] text-[14.5px] text-[var(--color-ink)]"
              >
                {LEAVE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex flex-wrap gap-4">
              <Field label="First day">
                <TextInput type="date" name="startDate" required />
              </Field>
              <Field label="Last day">
                <TextInput type="date" name="endDate" required />
              </Field>
            </div>
            <Field label="Note (optional)">
              <TextInput
                name="note"
                maxLength={500}
                placeholder="e.g. Family wedding"
              />
            </Field>
            <Button type="submit">Record leave</Button>
          </form>
        )}
      </Card>
    </>
  );
}
