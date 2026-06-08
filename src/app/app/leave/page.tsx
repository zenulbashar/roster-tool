import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ownerRepo } from "@/lib/auth/context";
import { enqueueLeaveDecision } from "@/lib/jobs/boss";
import { leaveRequestSchema } from "@/lib/validation";
import { leaveTypeLabel } from "@/lib/labels";
import { businessDateOf, formatDateRange } from "@/lib/time";
import {
  Banner,
  Button,
  Card,
  Field,
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
    if (decided) await enqueueLeaveDecision({ leaveRequestId: id });
    revalidatePath(PATH);
    redirect(`${PATH}?approved=1`);
  }

  async function denyLeave(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    const decided = await repo.decideLeaveRequest(id, "denied");
    if (decided) await enqueueLeaveDecision({ leaveRequestId: id });
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

  return (
    <>
      <PageHeader
        title="Leave"
        subtitle="Time-off requests from your team, and leave you've recorded. This records leave only — it doesn't track balances or calculate pay."
      />

      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}
      {sp.approved ? <Banner tone="success">Leave approved.</Banner> : null}
      {sp.denied ? <Banner tone="success">Leave declined.</Banner> : null}
      {sp.added ? <Banner tone="success">Leave recorded.</Banner> : null}
      {sp.deleted ? <Banner tone="success">Leave removed.</Banner> : null}

      <section className="mt-4" aria-label="Pending requests">
        <h2 className="mb-3 text-lg font-semibold">
          Requests to review ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-[var(--color-muted)]">
            No requests waiting. New requests from your team show up here.
          </p>
        ) : (
          <ul className="space-y-2">
            {pending.map((r) => (
              <li key={r.id}>
                <Card className="flex flex-wrap items-center justify-between gap-4 py-3">
                  <div>
                    <p className="font-semibold">
                      {r.staffName}
                      <span className="ml-2 rounded bg-[var(--color-canvas)] px-2 py-0.5 text-xs font-medium text-[var(--color-muted)]">
                        {leaveTypeLabel(r.leaveType)}
                      </span>
                    </p>
                    <p className="text-sm text-[var(--color-muted)]">
                      {formatDateRange(r.startDate, r.endDate)}
                    </p>
                    {r.note ? (
                      <p className="mt-1 text-sm text-[var(--color-ink)]">
                        &ldquo;{r.note}&rdquo;
                      </p>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <form action={approveLeave}>
                      <input type="hidden" name="id" value={r.id} />
                      <Button type="submit">Approve</Button>
                    </form>
                    <form action={denyLeave}>
                      <input type="hidden" name="id" value={r.id} />
                      <Button type="submit" variant="secondary">
                        Deny
                      </Button>
                    </form>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8" aria-label="Upcoming approved leave">
        <h2 className="mb-3 text-lg font-semibold">
          Upcoming approved leave ({upcoming.length})
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-[var(--color-muted)]">Nothing booked in.</p>
        ) : (
          <ul className="space-y-2">
            {upcoming.map((r) => (
              <li key={r.id}>
                <Card className="flex flex-wrap items-center justify-between gap-4 py-3">
                  <div>
                    <p className="font-semibold">
                      {r.staffName}
                      <span className="ml-2 rounded bg-[var(--color-canvas)] px-2 py-0.5 text-xs font-medium text-[var(--color-muted)]">
                        {leaveTypeLabel(r.leaveType)}
                      </span>
                    </p>
                    <p className="text-sm text-[var(--color-muted)]">
                      {formatDateRange(r.startDate, r.endDate)}
                    </p>
                  </div>
                  <form action={deleteLeave}>
                    <input type="hidden" name="id" value={r.id} />
                    <button
                      type="submit"
                      className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
                    >
                      Remove
                    </button>
                  </form>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card className="mt-8">
        <h2 className="text-lg font-semibold">Record leave</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Add leave a team member told you about. It&rsquo;s saved as approved
          straight away (no email is sent).
        </p>
        {staff.length === 0 ? (
          <p className="mt-3 text-[var(--color-muted)]">
            Add a team member first.
          </p>
        ) : (
          <form action={addLeaveDirect} className="mt-3 space-y-4">
            <Field label="Team member">
              <select
                name="staffMemberId"
                required
                aria-label="Team member"
                className="block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-base"
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
                className="block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-base"
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
