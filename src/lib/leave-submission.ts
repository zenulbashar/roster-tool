import type { TenantRepo } from "@/lib/tenant/repository";
import { authenticateStaffPinFromForm } from "@/lib/pin-auth";
import { leaveRequestSchema } from "@/lib/validation";
import { leaveTypeLabel } from "@/lib/labels";
import { formatDateRange } from "@/lib/time";
import { notifyOwner } from "@/lib/notifications";

/**
 * Result of a staff leave submission, shaped like the clock actions so the
 * shared client form can drive it with `useActionState`.
 */
export type LeaveSubmitResult =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

/**
 * Shared core for staff submitting a leave request, used by BOTH the
 * personal-phone (`/clock`) and shared-kiosk (`/kiosk`) PIN flows. The caller
 * resolves the business from its own capability token and passes a tenant-scoped
 * `repo` — the business is NEVER taken from client input. The staff member is
 * authenticated by the same PIN + per-staff brute-force cooldown as clock-in.
 *
 * Unlike clock-in, this deliberately performs NO geofence/location check:
 * requesting time off isn't a clock action and can be done from anywhere. A
 * valid submission creates a `pending` leave request; the owner approves/denies.
 */
export async function submitStaffLeave(
  repo: TenantRepo,
  formData: FormData,
  now: Date = new Date(),
  opts: { deviceKey?: string } = {},
): Promise<LeaveSubmitResult> {
  const parsed = leaveRequestSchema.safeParse({
    leaveType: formData.get("leaveType"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Please check the dates.";
    return { status: "error", message: msg };
  }

  const auth = await authenticateStaffPinFromForm(repo, formData, {
    deviceKey: opts.deviceKey,
    now,
  });
  if (!auth.ok) return { status: "error", message: auth.message };
  const staff = auth.staff;

  const { leaveType, startDate, endDate, note } = parsed.data;
  const created = await repo.createLeaveRequest({
    staffMemberId: staff.id,
    leaveType,
    startDate,
    endDate,
    note: note && note.length > 0 ? note : null,
    status: "pending",
  });
  if (!created) {
    return {
      status: "error",
      message: "Couldn't send your request. Try again.",
    };
  }

  // Best-effort owner notification (in addition to the in-app review on /app/leave).
  await notifyOwner(repo, {
    type: "leave_requested",
    title: `${staff.name} requested leave`,
    body: `${leaveTypeLabel(leaveType)} · ${formatDateRange(startDate, endDate)}`,
    linkPath: "/app/leave",
  });

  return {
    status: "success",
    message: `Thanks ${staff.name}, your ${leaveTypeLabel(leaveType).toLowerCase()} request for ${formatDateRange(startDate, endDate)} was sent to your manager.`,
  };
}
