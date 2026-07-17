import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ownerRepo, requireOwner } from "@/lib/auth/context";
import { createTenantRepo } from "@/lib/tenant/repository";
import { env } from "@/lib/env";
import { staffSchema, pinSchema, payRateSchema } from "@/lib/validation";
import { hashPin } from "@/lib/pin";
import { generateToken } from "@/lib/tokens";
import { logger } from "@/lib/logger";
import { formatDate, businessDateOf, DEFAULT_TIMEZONE } from "@/lib/time";
import { certStatus, daysUntil, expiryPhrase } from "@/lib/certification";
import {
  isDriveConfigured,
  googleDriveClient,
} from "@/lib/google-drive/client";
import { DriveReconnectRequired } from "@/lib/google-drive/errors";
import {
  deleteDocument,
  uploadDocumentToDrive,
} from "@/lib/google-drive/service";
import { DOC_TYPES, validateUpload } from "@/lib/google-drive/validation";
import { ClearFlashCookie } from "@/components/ClearFlashCookie";
import { CopyButton } from "@/components/CopyButton";
import { AddStaffFields } from "@/components/AddStaffFields";
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  Eyebrow,
  PageHeader,
  TextInput,
  type BadgeTone,
} from "@/components/ui";

const PATH = "/app/staff";

/**
 * Once-only flash cookie for a freshly generated notices link, carrying
 * "<staffId>:<token>" so the link renders beside the right person. Same
 * pattern as the kiosk link in Settings; only the hash is ever stored.
 */
const NOTICES_LINK_COOKIE = "notices_link_once";

const CERT_TYPE_LABEL: Record<string, string> = {
  rsa: "RSA",
  rsg: "RSG",
  food_safety: "Food Safety",
  first_aid: "First Aid",
  wwcc: "WWCC",
  other: "Certification",
};

const CERT_META: Record<
  "valid" | "expiring" | "expired",
  { tone: BadgeTone; label: string; icon: string; color: string }
> = {
  valid: {
    tone: "success",
    label: "VALID",
    icon: "check_circle",
    color: "#16A34A",
  },
  expiring: {
    tone: "warning",
    label: "EXPIRING SOON",
    icon: "warning",
    color: "#D97706",
  },
  expired: {
    tone: "danger",
    label: "EXPIRED",
    icon: "cancel",
    color: "#DC2626",
  },
};

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{
    s?: string;
    error?: string;
    added?: string;
    saved?: string;
    pin?: string;
    rate?: string;
    uploaded?: string;
    docDeleted?: string;
    staffDeleted?: string;
    confirmDelete?: string;
    count?: string;
  }>;
}) {
  const sp = await searchParams;
  const repo = await ownerRepo();
  const staff = await repo.listStaff();
  const business = await repo.getBusiness();
  const tz = business?.timezone ?? DEFAULT_TIMEZONE;
  const timeZone = business?.timezone ?? undefined;
  const today = businessDateOf(new Date(), tz);
  const leadDays = business?.certReminderLeadDays ?? 30;

  // Certifications (additive read) — per staff, for the CERT chip + detail list.
  const certs = await repo.listCertifications();
  const certsByStaff = new Map<
    string,
    {
      label: string;
      status: "valid" | "expiring" | "expired";
      detail: string;
    }[]
  >();
  for (const c of certs) {
    const status = certStatus(c.expiryDate, today, leadDays);
    const label = c.certLabel || CERT_TYPE_LABEL[c.certType] || "Certification";
    const detail = expiryPhrase(daysUntil(c.expiryDate, today));
    const list = certsByStaff.get(c.staffMemberId) ?? [];
    list.push({ label, status, detail });
    certsByStaff.set(c.staffMemberId, list);
  }

  // On approved leave today (additive read) — for the ON LEAVE chip.
  const onLeaveToday = new Set(
    (await repo.listApprovedLeaveBetween(today, today)).map(
      (l) => l.staffMemberId,
    ),
  );

  // Google Drive document state. Documents are grouped by staff member; uploads
  // are only offered when a usable connection exists.
  const driveConnection = await repo.getDriveConnection();
  const driveReady = isDriveConfigured() && driveConnection !== null;
  const driveNeedsReconnect = driveConnection?.needsReconnect ?? false;
  const allDocs = driveConnection ? await repo.listAllStaffDocuments() : [];
  const docsByStaff = new Map<string, typeof allDocs>();
  for (const d of allDocs) {
    const list = docsByStaff.get(d.staffMemberId) ?? [];
    list.push(d);
    docsByStaff.set(d.staffMemberId, list);
  }

  // A just-generated notices link, shown exactly once (we store only the hash).
  const cookieStore = await cookies();
  const freshRaw = cookieStore.get(NOTICES_LINK_COOKIE)?.value ?? "";
  const sep = freshRaw.indexOf(":");
  const freshNoticesLink =
    sep > 0
      ? {
          staffId: freshRaw.slice(0, sep),
          link: `${env.APP_URL}/me/${freshRaw.slice(sep + 1)}`,
        }
      : null;

  // Which staff member is shown in the detail pane (query-param driven).
  const selected =
    staff.find((s) => s.id === sp.s) ??
    staff.find((s) => s.active) ??
    staff[0] ??
    null;

  // A delete awaiting confirmation (the person has recorded hours).
  const pendingDelete = staff.find((s) => s.id === sp.confirmDelete) ?? null;

  async function addStaff(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const parsed = staffSchema.safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
    });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Please check the form";
      redirect(`${PATH}?error=${encodeURIComponent(msg)}`);
    }
    try {
      await repo.addStaff(parsed.data);
    } catch (err) {
      if (isUniqueViolation(err)) {
        redirect(
          `${PATH}?error=${encodeURIComponent("That email is already on your team")}`,
        );
      }
      throw err;
    }
    revalidatePath(PATH);
    redirect(`${PATH}?added=1`);
  }

  async function editStaff(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    const parsed = staffSchema.safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
    });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Please check the form";
      redirect(`${PATH}?s=${id}&error=${encodeURIComponent(msg)}`);
    }
    let updated;
    try {
      updated = await repo.updateStaff(id, {
        name: parsed.data.name,
        email: parsed.data.email,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        redirect(
          `${PATH}?s=${id}&error=${encodeURIComponent("That email is already on your team")}`,
        );
      }
      throw err;
    }
    if (!updated)
      redirect(`${PATH}?error=${encodeURIComponent("Staff member not found")}`);
    revalidatePath(PATH);
    redirect(`${PATH}?s=${id}&saved=1`);
  }

  async function deleteStaff(formData: FormData) {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const id = String(formData.get("id"));
    const confirmed = formData.get("confirmed") === "1";

    const member = await repo.getStaff(id);
    if (!member)
      redirect(`${PATH}?error=${encodeURIComponent("Staff member not found")}`);

    // Deleting is permanent and cascades away their timesheets, leave, certs
    // and documents. If they have recorded hours, bounce to a count-aware
    // confirmation instead of silently wiping the history.
    if (!confirmed) {
      const count = await repo.countTimesheetEntriesForStaff(id);
      if (count > 0) redirect(`${PATH}?confirmDelete=${id}&count=${count}`);
    }

    // Best-effort: remove the files this app created in the owner's Drive before
    // the DB cascade drops our references. A Drive error never blocks the delete.
    const docs = await repo.listStaffDocuments(id);
    for (const d of docs) {
      try {
        await deleteDocument({
          repo,
          client: googleDriveClient,
          documentId: d.id,
        });
      } catch (err) {
        logger.warn({ err }, "Drive file delete during staff removal failed");
      }
    }

    await repo.deleteStaff(id);
    revalidatePath(PATH);
    redirect(`${PATH}?staffDeleted=1`);
  }

  async function toggleActive(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    const active = formData.get("active") === "true";
    await repo.updateStaff(id, { active: !active });
    revalidatePath(PATH);
    redirect(`${PATH}?s=${id}`);
  }

  async function toggleNotify(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    // The hidden field carries the new value (the checkbox onChange submits).
    const notifyByDefault = formData.get("notifyByDefault") === "true";
    await repo.updateStaff(id, { notifyByDefault });
    revalidatePath(PATH);
    redirect(`${PATH}?s=${id}`);
  }

  async function setPin(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    const parsed = pinSchema.safeParse(formData.get("pin"));
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Enter a 4-digit PIN";
      redirect(`${PATH}?s=${id}&error=${encodeURIComponent(msg)}`);
    }
    // Hash before storing; the PIN itself is never persisted or logged.
    const updated = await repo.setStaffPin(id, hashPin(parsed.data));
    if (!updated)
      redirect(`${PATH}?error=${encodeURIComponent("Staff member not found")}`);
    revalidatePath(PATH);
    redirect(`${PATH}?s=${id}&pin=1`);
  }

  async function generateNoticesLink(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    const { token, tokenHash } = generateToken();
    // Store only the hash; a new link instantly revokes the old one.
    const updated = await repo.setStaffNoticesTokenHash(id, tokenHash);
    if (!updated)
      redirect(`${PATH}?error=${encodeURIComponent("Staff member not found")}`);
    // Flash the raw token so the next render shows the link once.
    const cookieStore = await cookies();
    cookieStore.set(NOTICES_LINK_COOKIE, `${id}:${token}`, {
      path: PATH,
      maxAge: 300,
      httpOnly: false,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
    });
    revalidatePath(PATH);
    redirect(`${PATH}?s=${id}`);
  }

  async function setRate(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    const parsed = payRateSchema.safeParse({
      rateType: formData.get("rateType"),
      rateDollars: formData.get("rateDollars") ?? "",
      rateLabel: formData.get("rateLabel") ?? "",
    });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Check the rate";
      redirect(`${PATH}?s=${id}&error=${encodeURIComponent(msg)}`);
    }
    // A blank amount clears the rate. We store cents; rounding avoids float drift.
    const { rateType, rateDollars, rateLabel } = parsed.data;
    const payRateCents =
      rateDollars === "" ? null : Math.round(Number(rateDollars) * 100);
    const updated = await repo.updateStaff(id, {
      payRateCents,
      rateType,
      rateLabel: rateLabel && rateLabel.length > 0 ? rateLabel : null,
    });
    if (!updated)
      redirect(`${PATH}?error=${encodeURIComponent("Staff member not found")}`);
    revalidatePath(PATH);
    redirect(`${PATH}?s=${id}&rate=1`);
  }

  async function uploadDocument(formData: FormData) {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const id = String(formData.get("id"));
    const file = formData.get("file");
    const docTypeRaw = String(formData.get("docType") ?? "");

    if (!(file instanceof File) || file.size === 0) {
      redirect(
        `${PATH}?s=${id}&error=${encodeURIComponent("Choose a file to upload.")}`,
      );
    }
    const f = file as File;
    const valid = validateUpload({ size: f.size, mimeType: f.type });
    if (!valid.ok) {
      redirect(`${PATH}?s=${id}&error=${encodeURIComponent(valid.message)}`);
    }
    // Confirm the staff member is this business's before doing any Drive work.
    const member = await repo.getStaff(id);
    if (!member) {
      redirect(`${PATH}?error=${encodeURIComponent("Staff member not found")}`);
    }
    const docType = (DOC_TYPES as readonly string[]).includes(docTypeRaw)
      ? docTypeRaw
      : null;
    // Read the bytes to forward to Drive. They are NEVER persisted in our DB
    // and never logged.
    const body = Buffer.from(await f.arrayBuffer());
    try {
      await uploadDocumentToDrive({
        repo,
        client: googleDriveClient,
        staffMemberId: id,
        fileName: f.name.slice(0, 255) || "document",
        docType,
        mimeType: f.type,
        body,
      });
    } catch (err) {
      if (err instanceof DriveReconnectRequired) {
        redirect(
          `${PATH}?s=${id}&error=${encodeURIComponent(
            "Reconnect Google Drive in Settings to upload documents.",
          )}`,
        );
      }
      logger.error({ err }, "Staff document upload failed");
      redirect(
        `${PATH}?s=${id}&error=${encodeURIComponent("Couldn’t upload the document. Please try again.")}`,
      );
    }
    revalidatePath(PATH);
    redirect(`${PATH}?s=${id}&uploaded=1`);
  }

  async function deleteDocumentAction(formData: FormData) {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const documentId = String(formData.get("documentId"));
    const staffId = String(formData.get("staffId") ?? "");
    // Scoped delete: a foreign document id resolves to nothing and is a no-op.
    await deleteDocument({
      repo,
      client: googleDriveClient,
      documentId,
    });
    revalidatePath(PATH);
    redirect(`${PATH}?s=${staffId}&docDeleted=1`);
  }

  const activeCount = staff.filter((s) => s.active).length;

  return (
    <>
      <PageHeader
        title="Staff"
        subtitle="Your team, their rates, certifications and documents — all in one place."
      />

      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}
      {sp.added ? <Banner tone="success">Staff member added.</Banner> : null}
      {sp.saved ? <Banner tone="success">Details saved.</Banner> : null}
      {sp.staffDeleted ? (
        <Banner tone="success">Staff member deleted.</Banner>
      ) : null}
      {sp.pin ? <Banner tone="success">PIN updated.</Banner> : null}
      {sp.rate ? <Banner tone="success">Pay rate saved.</Banner> : null}
      {sp.uploaded ? (
        <Banner tone="success">Document uploaded to your Drive.</Banner>
      ) : null}
      {sp.docDeleted ? <Banner tone="success">Document removed.</Banner> : null}

      {/* Count-aware confirmation before a permanent delete. */}
      {pendingDelete ? (
        <Card className="mt-4 border-[var(--color-danger)]">
          <h2 className="font-archivo text-[17px] font-bold text-[var(--color-ink)]">
            Delete {pendingDelete.name}?
          </h2>
          <p className="mt-1 text-[13.5px] text-[var(--color-text-secondary)]">
            {pendingDelete.name} has {sp.count} recorded timesheet
            {sp.count === "1" ? " entry" : " entries"}. Deleting permanently
            removes them and all their records — timesheets, leave,
            certifications and documents. This can’t be undone. To keep their
            history instead, use <strong>Deactivate</strong>.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <form action={deleteStaff}>
              <input type="hidden" name="id" value={pendingDelete.id} />
              <input type="hidden" name="confirmed" value="1" />
              <Button type="submit" variant="danger">
                Delete permanently
              </Button>
            </form>
            <Link
              href={`${PATH}?s=${pendingDelete.id}`}
              className="text-[13px] font-semibold text-[var(--color-text-secondary)] hover:underline"
            >
              Cancel
            </Link>
          </div>
        </Card>
      ) : null}

      {/* Add-someone inline bar. */}
      <Card className="mt-4" padded={false}>
        <form
          action={addStaff}
          className="flex flex-wrap items-center gap-3 p-[14px]"
        >
          <span className="inline-flex items-center gap-1.5 font-archivo text-[13px] font-bold text-[var(--color-ink)]">
            <span className="material-symbols-rounded text-[19px] text-[#2E7D4E]">
              person_add
            </span>
            Add someone
          </span>
          <AddStaffFields />
          <Button type="submit">Add to team</Button>
        </form>
      </Card>

      {staff.length === 0 ? (
        <Card className="mt-[18px]">
          <p className="text-[var(--color-text-secondary)]">
            No one yet. Add your first team member above.
          </p>
        </Card>
      ) : (
        <div className="mt-[18px] grid grid-cols-1 items-start gap-[18px] lg:grid-cols-[340px_1fr]">
          {/* Left: staff list. */}
          <div
            className="flex flex-col gap-[9px]"
            aria-label={`Your team (${activeCount} active)`}
          >
            {staff.map((s) => {
              const isSel = selected?.id === s.id;
              const staffCerts = certsByStaff.get(s.id) ?? [];
              const certWarn = staffCerts.some(
                (c) => c.status === "expiring" || c.status === "expired",
              );
              return (
                <Link
                  key={s.id}
                  href={`${PATH}?s=${s.id}`}
                  aria-current={isSel ? "true" : undefined}
                  className={`flex items-center gap-3 rounded-[13px] border p-[13px] transition-colors hover:border-[var(--color-button)] ${
                    isSel
                      ? "border-[var(--color-button)] bg-[var(--color-accent-faint)]"
                      : "border-[var(--color-border)] bg-white"
                  }`}
                >
                  <Avatar name={s.name} colorKey={s.id} size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-bold text-[var(--color-ink)]">
                      {s.name}
                    </div>
                    <div className="truncate text-[12px] text-[var(--color-text-secondary)]">
                      {s.rateLabel ? `${s.rateLabel} · ` : ""}
                      {s.email}
                    </div>
                    {!s.active || certWarn || onLeaveToday.has(s.id) ? (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {!s.active ? (
                          <span className="rounded-[5px] border border-[var(--color-border)] bg-[#F3F4F6] px-[7px] py-0.5 text-[9.5px] font-bold tracking-[0.03em] text-[#6B7280]">
                            INACTIVE
                          </span>
                        ) : null}
                        {onLeaveToday.has(s.id) ? (
                          <span className="rounded-[5px] border border-[var(--color-border)] bg-[#F3F4F6] px-[7px] py-0.5 text-[9.5px] font-bold tracking-[0.03em] text-[#6B7280]">
                            ON LEAVE
                          </span>
                        ) : null}
                        {certWarn ? (
                          <span className="inline-flex items-center gap-0.5 rounded-[5px] border border-[#FED7AA] bg-[#FEF3E2] px-[7px] py-0.5 text-[9.5px] font-bold tracking-[0.03em] text-[#B45309]">
                            <span className="material-symbols-rounded text-[13px]">
                              warning
                            </span>
                            CERT
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <span
                    aria-hidden="true"
                    className="material-symbols-rounded text-[20px] text-[var(--color-text-muted)]"
                  >
                    chevron_right
                  </span>
                </Link>
              );
            })}
          </div>

          {/* Right: selected staff detail. */}
          {selected ? (
            <div className="overflow-hidden rounded-[16px] border border-[var(--color-border)] bg-white shadow-[0_1px_3px_rgba(17,24,39,0.05)]">
              {/* Header */}
              <div className="flex flex-wrap items-center gap-[15px] border-b border-[var(--color-border-subtle)] p-[22px]">
                <Avatar name={selected.name} colorKey={selected.id} size={54} />
                <div className="min-w-0 flex-1">
                  <div className="font-archivo text-[20px] font-extrabold text-[var(--color-ink)]">
                    {selected.name}
                    {!selected.active ? (
                      <span className="ml-2 align-middle text-[12px] font-semibold text-[var(--color-text-muted)]">
                        (inactive)
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[13px] text-[var(--color-text-secondary)]">
                    {selected.email}
                  </div>
                </div>
                <form action={toggleActive}>
                  <input type="hidden" name="id" value={selected.id} />
                  <input
                    type="hidden"
                    name="active"
                    value={String(selected.active)}
                  />
                  <Button type="submit" variant="secondary">
                    {selected.active ? "Deactivate" : "Reactivate"}
                  </Button>
                </form>
              </div>

              {/* Edit details + remove */}
              <details className="border-b border-[var(--color-border-subtle)] px-[22px] py-[14px]">
                <summary className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] font-semibold text-[#2E7D4E]">
                  <span className="material-symbols-rounded text-[18px]">
                    edit
                  </span>
                  Edit details
                </summary>
                <form
                  action={editStaff}
                  className="mt-3 flex flex-wrap items-end gap-2"
                >
                  <input type="hidden" name="id" value={selected.id} />
                  <label className="block">
                    <span className="mb-1 block text-[12px] font-semibold">
                      Full name
                    </span>
                    <TextInput
                      name="name"
                      required
                      maxLength={120}
                      defaultValue={selected.name}
                      aria-label="Full name"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[12px] font-semibold">
                      Email address
                    </span>
                    <TextInput
                      type="email"
                      name="email"
                      required
                      maxLength={200}
                      defaultValue={selected.email}
                      aria-label="Email address"
                    />
                  </label>
                  <Button type="submit" variant="secondary">
                    Save details
                  </Button>
                </form>

                <div className="mt-4 border-t border-[var(--color-border-subtle)] pt-3">
                  <Eyebrow className="mb-1 block text-[var(--color-danger)]">
                    Danger zone
                  </Eyebrow>
                  <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
                    Deleting removes {selected.name} and all their records
                    permanently. To keep their timesheets and history, use{" "}
                    <strong>Deactivate</strong> instead.
                  </p>
                  <form action={deleteStaff}>
                    <input type="hidden" name="id" value={selected.id} />
                    <Button type="submit" variant="danger">
                      <span className="material-symbols-rounded text-[17px]">
                        delete
                      </span>
                      Delete permanently
                    </Button>
                  </form>
                </div>
              </details>

              {/* Pay rate + notices + PIN */}
              <div className="grid grid-cols-1 gap-[22px] p-[22px] sm:grid-cols-2">
                <div>
                  <Eyebrow className="mb-2 block">Pay rate</Eyebrow>
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-archivo text-[24px] font-extrabold text-[var(--color-ink)]">
                      {selected.payRateCents != null
                        ? `$${(selected.payRateCents / 100).toFixed(2)}`
                        : "—"}
                    </span>
                    <span className="text-[13px] text-[var(--color-text-secondary)]">
                      / hour
                    </span>
                  </div>
                  <div className="mt-1 text-[12.5px] text-[var(--color-text-secondary)]">
                    {selected.rateType === "award" ? "Award" : "Flat"}
                    {selected.rateLabel
                      ? ` · ${selected.rateLabel}`
                      : ""} ·{" "}
                    <span className="text-[var(--color-text-muted)]">
                      informational only
                    </span>
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[12.5px] font-semibold text-[#2E7D4E]">
                      Edit rate
                    </summary>
                    <form action={setRate} className="mt-2 space-y-2">
                      <input type="hidden" name="id" value={selected.id} />
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="block">
                          <span className="mb-1 block text-[12px] font-semibold">
                            Rate type
                          </span>
                          <select
                            name="rateType"
                            defaultValue={selected.rateType}
                            aria-label="Rate type"
                            className="rounded-[9px] border border-[var(--color-line)] bg-white px-3 py-2 text-[13px]"
                          >
                            <option value="flat">Flat</option>
                            <option value="award">Award</option>
                          </select>
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[12px] font-semibold">
                            Hourly ($)
                          </span>
                          <TextInput
                            name="rateDollars"
                            inputMode="decimal"
                            placeholder="28.50"
                            defaultValue={
                              selected.payRateCents != null
                                ? (selected.payRateCents / 100).toFixed(2)
                                : ""
                            }
                            className="w-24"
                            aria-label="Hourly rate"
                          />
                        </label>
                      </div>
                      <label className="block">
                        <span className="mb-1 block text-[12px] font-semibold">
                          Label (optional)
                        </span>
                        <TextInput
                          name="rateLabel"
                          maxLength={80}
                          placeholder="e.g. Level 2 cook"
                          defaultValue={selected.rateLabel ?? ""}
                          aria-label="Rate label"
                        />
                      </label>
                      <Button type="submit" variant="secondary">
                        Save rate
                      </Button>
                      <p className="text-[11.5px] text-[var(--color-text-muted)]">
                        Stored for your records and the hours export. This app
                        doesn&apos;t calculate pay — no penalty rates, overtime
                        or super.
                      </p>
                    </form>
                  </details>
                </div>

                <div>
                  <Eyebrow className="mb-2 block">Staff notices</Eyebrow>
                  {freshNoticesLink?.staffId === selected.id ? (
                    <div className="mb-2">
                      <ClearFlashCookie
                        name={NOTICES_LINK_COOKIE}
                        path={PATH}
                      />
                      <Banner tone="success">
                        Copy this private link for {selected.name} now — for
                        security we won&apos;t show it again.
                      </Banner>
                      <p className="mt-2 break-all rounded-[9px] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 font-mono text-[12px]">
                        {freshNoticesLink.link}
                      </p>
                      <div className="mt-2">
                        <CopyButton
                          value={freshNoticesLink.link}
                          label="Copy notices link"
                        />
                      </div>
                    </div>
                  ) : null}
                  <form action={generateNoticesLink}>
                    <input type="hidden" name="id" value={selected.id} />
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 rounded-[9px] border border-[#CFE3D6] bg-[var(--color-accent-faint)] px-[13px] py-[9px] text-[13px] font-semibold text-[#13301F] hover:bg-[#EAF3D8]"
                    >
                      <span className="material-symbols-rounded text-[17px]">
                        link
                      </span>
                      {selected.noticesTokenHash
                        ? "Replace notices link"
                        : "Create notices link"}
                    </button>
                  </form>
                  <p className="mt-1.5 text-[11.5px] text-[var(--color-text-muted)]">
                    PIN-gated /me link for them to check shifts, leave decisions
                    and reminders. A new link replaces the old one.
                  </p>

                  <div className="mt-4">
                    <Eyebrow className="mb-2 block">Clock-in PIN</Eyebrow>
                    <form
                      action={setPin}
                      className="flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="id" value={selected.id} />
                      <TextInput
                        name="pin"
                        inputMode="numeric"
                        autoComplete="off"
                        pattern="\d{4}"
                        maxLength={4}
                        required
                        placeholder="4 digits"
                        className="w-28"
                        aria-label={`Set clock-in PIN for ${selected.name}`}
                      />
                      <Button type="submit" variant="secondary">
                        {selected.pinHash ? "Reset PIN" : "Set PIN"}
                      </Button>
                    </form>
                  </div>

                  <div className="mt-4">
                    <Eyebrow className="mb-2 block">
                      Availability emails
                    </Eyebrow>
                    <form action={toggleNotify}>
                      <input type="hidden" name="id" value={selected.id} />
                      <input
                        type="hidden"
                        name="notifyByDefault"
                        value={String(!selected.notifyByDefault)}
                      />
                      <button
                        type="submit"
                        role="switch"
                        aria-checked={selected.notifyByDefault}
                        className="inline-flex items-center gap-2 text-[13px] font-medium text-[var(--color-ink)]"
                      >
                        <span
                          aria-hidden="true"
                          className={`relative inline-block h-[26px] w-[44px] rounded-full transition-colors ${
                            selected.notifyByDefault
                              ? "bg-[var(--color-button)]"
                              : "bg-[var(--color-line)]"
                          }`}
                        >
                          <span
                            className={`absolute left-[3px] top-[3px] h-[20px] w-[20px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform ${
                              selected.notifyByDefault
                                ? "translate-x-[18px]"
                                : "translate-x-0"
                            }`}
                          />
                        </span>
                        Ask by email by default
                      </button>
                    </form>
                  </div>
                </div>
              </div>

              {/* Certifications */}
              <div className="px-[22px] pb-[18px]">
                <div className="mb-[11px] flex items-center justify-between">
                  <Eyebrow>Certifications</Eyebrow>
                  <Link
                    href="/app/certifications"
                    className="text-[12px] font-semibold text-[#2E7D4E] hover:underline"
                  >
                    Manage →
                  </Link>
                </div>
                {(certsByStaff.get(selected.id) ?? []).length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {(certsByStaff.get(selected.id) ?? []).map((c, i) => {
                      const m = CERT_META[c.status];
                      return (
                        <div
                          key={i}
                          className="flex items-center gap-[11px] rounded-[10px] border border-[var(--color-border-subtle)] px-[13px] py-[11px]"
                        >
                          <span
                            className="material-symbols-rounded text-[21px]"
                            style={{ color: m.color }}
                          >
                            {m.icon}
                          </span>
                          <span className="flex-1 text-[13.5px] font-semibold text-[var(--color-ink)]">
                            {c.label}
                          </span>
                          <span className="text-[12.5px] text-[var(--color-text-secondary)]">
                            {c.detail}
                          </span>
                          <Badge tone={m.tone}>{m.label}</Badge>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[12.5px] text-[var(--color-text-muted)]">
                    No certifications recorded.{" "}
                    <Link
                      href="/app/certifications"
                      className="text-[#2E7D4E] hover:underline"
                    >
                      Add one →
                    </Link>
                  </p>
                )}
              </div>

              {/* Documents (Google Drive) */}
              <div className="border-t border-[var(--color-border-subtle)] bg-[#FAFBFC] p-[22px]">
                <div className="mb-[11px] flex items-center justify-between">
                  <Eyebrow>Documents</Eyebrow>
                  {driveReady && !driveNeedsReconnect ? (
                    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-[#15803D]">
                      <span className="h-[7px] w-[7px] rounded-full bg-[#16A34A]" />
                      Drive connected
                    </span>
                  ) : null}
                </div>
                {!driveReady ? (
                  <div className="flex items-center gap-3.5 rounded-[11px] border border-dashed border-[var(--color-line)] bg-white p-4">
                    <span className="material-symbols-rounded text-[26px] text-[var(--color-text-muted)]">
                      add_to_drive
                    </span>
                    <div className="flex-1">
                      <div className="text-[13px] font-semibold text-[var(--color-ink)]">
                        Connect Google Drive
                      </div>
                      <div className="mt-0.5 text-[12px] text-[var(--color-text-secondary)]">
                        Store {selected.name}&apos;s documents in your own Drive
                        — contracts, certificates, ID stay in your account.
                      </div>
                    </div>
                    <Link
                      href="/app/settings"
                      className="whitespace-nowrap rounded-[9px] bg-[var(--color-button)] px-[14px] py-[9px] font-archivo text-[12.5px] font-bold text-[var(--color-button-ink)] hover:bg-[var(--color-accent-dark)]"
                    >
                      Connect in Settings
                    </Link>
                  </div>
                ) : driveNeedsReconnect ? (
                  <p className="text-[12.5px] text-[var(--color-text-secondary)]">
                    Google Drive needs reconnecting — fix it in{" "}
                    <Link
                      href="/app/settings"
                      className="text-[#2E7D4E] underline underline-offset-2"
                    >
                      Settings
                    </Link>{" "}
                    to upload documents.
                  </p>
                ) : (
                  <>
                    {(docsByStaff.get(selected.id) ?? []).length > 0 ? (
                      <div className="mb-3 flex flex-col gap-[7px]">
                        {(docsByStaff.get(selected.id) ?? []).map((d) => (
                          <div
                            key={d.id}
                            className="flex flex-wrap items-center gap-[11px] rounded-[9px] border border-[var(--color-border)] bg-white px-[13px] py-[10px]"
                          >
                            <span className="material-symbols-rounded text-[20px] text-[#2563EB]">
                              description
                            </span>
                            <span className="flex-1 text-[13px] font-medium text-[var(--color-ink)]">
                              {d.fileName}
                            </span>
                            {d.docType ? (
                              <span className="rounded bg-[var(--color-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
                                {d.docType}
                              </span>
                            ) : null}
                            <span className="text-[11px] text-[var(--color-text-muted)]">
                              {formatDate(d.uploadedAt, timeZone)}
                            </span>
                            <a
                              href={d.driveWebLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#2E7D4E]"
                            >
                              <span className="material-symbols-rounded text-[15px]">
                                open_in_new
                              </span>
                              Open
                            </a>
                            <form action={deleteDocumentAction}>
                              <input
                                type="hidden"
                                name="documentId"
                                value={d.id}
                              />
                              <input
                                type="hidden"
                                name="staffId"
                                value={selected.id}
                              />
                              <button
                                type="submit"
                                aria-label={`Delete ${d.fileName}`}
                                className="flex text-[var(--color-text-muted)] hover:text-[#DC2626]"
                              >
                                <span className="material-symbols-rounded text-[18px]">
                                  delete
                                </span>
                              </button>
                            </form>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mb-3 text-[12.5px] text-[var(--color-text-muted)]">
                        No documents yet. Upload a contract or certificate to
                        keep it in your Drive.
                      </p>
                    )}

                    <form
                      action={uploadDocument}
                      encType="multipart/form-data"
                      className="flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="id" value={selected.id} />
                      <label className="block">
                        <span className="mb-1 block text-[12px] font-semibold">
                          Add a document
                        </span>
                        <input
                          type="file"
                          name="file"
                          required
                          aria-label={`Upload a document for ${selected.name}`}
                          className="block max-w-full text-[13px]"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[12px] font-semibold">
                          Type
                        </span>
                        <select
                          name="docType"
                          defaultValue="Other"
                          aria-label="Document type"
                          className="rounded-[9px] border border-[var(--color-line)] bg-white px-3 py-2 text-[13px]"
                        >
                          {DOC_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Button type="submit" variant="secondary">
                        <span className="material-symbols-rounded text-[17px] text-[#2E7D4E]">
                          upload_file
                        </span>
                        Upload document
                      </Button>
                    </form>
                    <p className="mt-1.5 text-[11.5px] text-[var(--color-text-muted)]">
                      Stored in your Google Drive (max 10 MB). Deleting here
                      also removes the file from your Drive.
                    </p>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
