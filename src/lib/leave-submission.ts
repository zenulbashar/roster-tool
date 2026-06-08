import type { TenantRepo } from "@/lib/tenant/repository";
import {
  verifyPin,
  isLockedOut,
  registerFailedAttempt,
  clearedLockout,
  PIN_LOCKOUT_MS,
} from "@/lib/pin";
import { pinSchema, leaveRequestSchema } from "@/lib/validation";
import { leaveTypeLabel } from "@/lib/labels";
import { formatDateRange } from "@/lib/time";

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
): Promise<LeaveSubmitResult> {
  const staffId = formData.get("staffId");
  const pinParsed = pinSchema.safeParse(formData.get("pin"));
  if (typeof staffId !== "string" || !staffId || !pinParsed.success) {
    return { status: "error", message: "Enter your 4-digit PIN." };
  }

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

  const staff = await repo.getStaff(staffId);
  // Same generic message whether the person is missing, inactive or PIN-less,
  // so the screen doesn't reveal who has a PIN.
  if (!staff || !staff.active || !staff.pinHash) {
    return { status: "error", message: "That PIN didn't match. Try again." };
  }

  const lock = isLockedOut(
    {
      failedPinAttempts: staff.failedPinAttempts,
      pinLockedUntil: staff.pinLockedUntil,
    },
    now,
  );
  if (lock.locked) {
    const secs = Math.ceil(lock.retryAfterMs / 1000);
    return {
      status: "error",
      message: `Too many wrong PINs. Please wait ${secs}s and try again.`,
    };
  }

  if (!verifyPin(pinParsed.data, staff.pinHash)) {
    const next = registerFailedAttempt(
      {
        failedPinAttempts: staff.failedPinAttempts,
        pinLockedUntil: staff.pinLockedUntil,
      },
      now,
    );
    await repo.updateStaffLockout(staff.id, next);
    if (next.pinLockedUntil) {
      const secs = Math.ceil(PIN_LOCKOUT_MS / 1000);
      return {
        status: "error",
        message: `Too many wrong PINs. Please wait ${secs}s and try again.`,
      };
    }
    return { status: "error", message: "That PIN didn't match. Try again." };
  }

  // Correct PIN: wipe the brute-force counter.
  await repo.updateStaffLockout(staff.id, clearedLockout());

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

  return {
    status: "success",
    message: `Thanks ${staff.name}, your ${leaveTypeLabel(leaveType).toLowerCase()} request for ${formatDateRange(startDate, endDate)} was sent to your manager.`,
  };
}
