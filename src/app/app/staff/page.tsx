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
import { formatDate } from "@/lib/time";
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
import {
  Banner,
  Button,
  Card,
  Field,
  PageHeader,
  TextInput,
} from "@/components/ui";

const PATH = "/app/staff";

/**
 * Once-only flash cookie for a freshly generated notices link, carrying
 * "<staffId>:<token>" so the link renders beside the right person. Same
 * pattern as the kiosk link in Settings; only the hash is ever stored.
 */
const NOTICES_LINK_COOKIE = "notices_link_once";

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
    error?: string;
    added?: string;
    pin?: string;
    rate?: string;
    uploaded?: string;
    docDeleted?: string;
  }>;
}) {
  const sp = await searchParams;
  const repo = await ownerRepo();
  const staff = await repo.listStaff();
  const business = await repo.getBusiness();
  const timeZone = business?.timezone ?? undefined;

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

  async function toggleActive(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    const active = formData.get("active") === "true";
    await repo.updateStaff(id, { active: !active });
    revalidatePath(PATH);
  }

  async function toggleNotify(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    // The hidden field carries the new value (the checkbox onChange submits).
    const notifyByDefault = formData.get("notifyByDefault") === "true";
    await repo.updateStaff(id, { notifyByDefault });
    revalidatePath(PATH);
  }

  async function setPin(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    const parsed = pinSchema.safeParse(formData.get("pin"));
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Enter a 4-digit PIN";
      redirect(`${PATH}?error=${encodeURIComponent(msg)}`);
    }
    // Hash before storing; the PIN itself is never persisted or logged.
    const updated = await repo.setStaffPin(id, hashPin(parsed.data));
    if (!updated)
      redirect(`${PATH}?error=${encodeURIComponent("Staff member not found")}`);
    revalidatePath(PATH);
    redirect(`${PATH}?pin=1`);
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
    redirect(PATH);
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
      redirect(`${PATH}?error=${encodeURIComponent(msg)}`);
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
    redirect(`${PATH}?rate=1`);
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
        `${PATH}?error=${encodeURIComponent("Choose a file to upload.")}`,
      );
    }
    const f = file as File;
    const valid = validateUpload({ size: f.size, mimeType: f.type });
    if (!valid.ok) {
      redirect(`${PATH}?error=${encodeURIComponent(valid.message)}`);
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
          `${PATH}?error=${encodeURIComponent(
            "Reconnect Google Drive in Settings to upload documents.",
          )}`,
        );
      }
      logger.error({ err }, "Staff document upload failed");
      redirect(
        `${PATH}?error=${encodeURIComponent("Couldn’t upload the document. Please try again.")}`,
      );
    }
    revalidatePath(PATH);
    redirect(`${PATH}?uploaded=1`);
  }

  async function deleteDocumentAction(formData: FormData) {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const documentId = String(formData.get("documentId"));
    // Scoped delete: a foreign document id resolves to nothing and is a no-op.
    await deleteDocument({
      repo,
      client: googleDriveClient,
      documentId,
    });
    revalidatePath(PATH);
    redirect(`${PATH}?docDeleted=1`);
  }

  return (
    <>
      <PageHeader
        title="Staff"
        subtitle="The people who work for you. We'll email them when you ask for availability."
      />

      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}
      {sp.added ? <Banner tone="success">Staff member added.</Banner> : null}
      {sp.pin ? <Banner tone="success">PIN updated.</Banner> : null}
      {sp.rate ? <Banner tone="success">Pay rate saved.</Banner> : null}
      {sp.uploaded ? (
        <Banner tone="success">Document uploaded to your Drive.</Banner>
      ) : null}
      {sp.docDeleted ? <Banner tone="success">Document removed.</Banner> : null}

      <Card className="mt-4">
        <h2 className="text-lg font-semibold">Add someone</h2>
        <form action={addStaff} className="mt-3 space-y-4">
          <Field label="Name">
            <TextInput name="name" required placeholder="e.g. Ava Nguyen" />
          </Field>
          <Field label="Email">
            <TextInput
              type="email"
              name="email"
              required
              placeholder="ava@example.com"
            />
          </Field>
          <Button type="submit">Add to team</Button>
        </form>
      </Card>

      <section className="mt-8" aria-label="Your team">
        <h2 className="mb-3 text-lg font-semibold">
          Your team ({staff.filter((s) => s.active).length})
        </h2>
        {staff.length === 0 ? (
          <p className="text-[var(--color-muted)]">
            No one yet. Add your first team member above.
          </p>
        ) : (
          <ul className="space-y-2">
            {staff.map((s) => (
              <li key={s.id}>
                <Card className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="font-semibold">
                      {s.name}
                      {!s.active ? (
                        <span className="ml-2 rounded bg-[var(--color-canvas)] px-2 py-0.5 text-xs font-medium text-[var(--color-muted)]">
                          Inactive
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm text-[var(--color-muted)]">
                      {s.email}
                    </p>
                    <form action={toggleNotify} className="mt-2">
                      <input type="hidden" name="id" value={s.id} />
                      <input
                        type="hidden"
                        name="notifyByDefault"
                        value={String(!s.notifyByDefault)}
                      />
                      <button
                        type="submit"
                        role="switch"
                        aria-checked={s.notifyByDefault}
                        className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-ink)]"
                      >
                        <span
                          aria-hidden="true"
                          className={`inline-flex h-5 w-9 items-center rounded-full border px-0.5 transition-colors ${
                            s.notifyByDefault
                              ? "justify-end border-[var(--color-ok)] bg-[var(--color-ok)]"
                              : "justify-start border-[var(--color-line)] bg-[var(--color-canvas)]"
                          }`}
                        >
                          <span className="h-4 w-4 rounded-full bg-white" />
                        </span>
                        Ask for availability by email
                        <span className="text-[var(--color-muted)]">
                          {s.notifyByDefault ? "On" : "Off"}
                        </span>
                      </button>
                    </form>
                    <form
                      action={setPin}
                      className="mt-3 flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="id" value={s.id} />
                      <label className="block">
                        <span className="mb-1 block text-sm font-semibold">
                          Clock-in PIN
                          <span className="ml-2 font-normal text-[var(--color-muted)]">
                            {s.pinHash ? "Set" : "Not set"}
                          </span>
                        </span>
                        <TextInput
                          name="pin"
                          inputMode="numeric"
                          autoComplete="off"
                          pattern="\d{4}"
                          maxLength={4}
                          required
                          placeholder="4 digits"
                          className="w-32"
                          aria-label={`Set clock-in PIN for ${s.name}`}
                        />
                      </label>
                      <Button type="submit" variant="secondary">
                        {s.pinHash ? "Reset PIN" : "Set PIN"}
                      </Button>
                    </form>
                    <form
                      action={setRate}
                      className="mt-3 flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="id" value={s.id} />
                      <label className="block">
                        <span className="mb-1 block text-sm font-semibold">
                          Rate type
                        </span>
                        <select
                          name="rateType"
                          defaultValue={s.rateType}
                          aria-label={`Rate type for ${s.name}`}
                          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2 text-sm"
                        >
                          <option value="flat">Flat</option>
                          <option value="award">Award</option>
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-sm font-semibold">
                          Hourly rate ($)
                        </span>
                        <TextInput
                          name="rateDollars"
                          inputMode="decimal"
                          placeholder="e.g. 28.50"
                          defaultValue={
                            s.payRateCents != null
                              ? (s.payRateCents / 100).toFixed(2)
                              : ""
                          }
                          className="w-28"
                          aria-label={`Hourly rate for ${s.name}`}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-sm font-semibold">
                          Label (optional)
                        </span>
                        <TextInput
                          name="rateLabel"
                          maxLength={80}
                          placeholder="e.g. Level 2 cook"
                          defaultValue={s.rateLabel ?? ""}
                          className="w-44"
                          aria-label={`Rate label for ${s.name}`}
                        />
                      </label>
                      <Button type="submit" variant="secondary">
                        Save rate
                      </Button>
                    </form>
                    <p className="mt-1 text-xs text-[var(--color-muted)]">
                      A stored rate for your records and the hours export. This
                      app doesn&apos;t calculate pay — no penalty rates,
                      overtime or super.
                    </p>
                    <div className="mt-3">
                      <span className="block text-sm font-semibold">
                        Notices link
                        <span className="ml-2 font-normal text-[var(--color-muted)]">
                          {s.noticesTokenHash ? "Active" : "Not set"}
                        </span>
                      </span>
                      {freshNoticesLink?.staffId === s.id ? (
                        <div className="mt-2">
                          <ClearFlashCookie
                            name={NOTICES_LINK_COOKIE}
                            path={PATH}
                          />
                          <Banner tone="success">
                            Share this private link with {s.name}. Copy it now —
                            for security we won&apos;t show it again.
                          </Banner>
                          <p className="mt-2 break-all rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2 font-mono text-sm">
                            {freshNoticesLink.link}
                          </p>
                        </div>
                      ) : null}
                      <form action={generateNoticesLink} className="mt-2">
                        <input type="hidden" name="id" value={s.id} />
                        <Button type="submit" variant="secondary">
                          {s.noticesTokenHash
                            ? "Replace notices link"
                            : "Create notices link"}
                        </Button>
                      </form>
                      <p className="mt-1 text-xs text-[var(--color-muted)]">
                        {s.name}&apos;s private page for roster updates, leave
                        decisions and shift reminders — it opens with their PIN.
                        A new link replaces the old one.
                      </p>
                    </div>

                    <div className="mt-4 border-t border-[var(--color-line)] pt-3">
                      <span className="block text-sm font-semibold">
                        Documents
                      </span>
                      {!driveReady ? (
                        <p className="mt-1 text-xs text-[var(--color-muted)]">
                          Connect Google Drive in{" "}
                          <a
                            href="/app/settings"
                            className="text-[var(--color-brand)] underline underline-offset-2"
                          >
                            Settings
                          </a>{" "}
                          to store {s.name}&apos;s documents in your own Drive.
                        </p>
                      ) : driveNeedsReconnect ? (
                        <p className="mt-1 text-xs text-[var(--color-muted)]">
                          Google Drive needs reconnecting — fix it in{" "}
                          <a
                            href="/app/settings"
                            className="text-[var(--color-brand)] underline underline-offset-2"
                          >
                            Settings
                          </a>{" "}
                          to upload documents.
                        </p>
                      ) : (
                        <>
                          {(docsByStaff.get(s.id) ?? []).length > 0 ? (
                            <ul className="mt-2 space-y-1">
                              {(docsByStaff.get(s.id) ?? []).map((d) => (
                                <li
                                  key={d.id}
                                  className="flex flex-wrap items-center gap-2 text-sm"
                                >
                                  <a
                                    href={d.driveWebLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[var(--color-brand)] underline underline-offset-2"
                                  >
                                    {d.fileName}
                                  </a>
                                  {d.docType ? (
                                    <span className="rounded bg-[var(--color-canvas)] px-2 py-0.5 text-xs font-medium text-[var(--color-muted)]">
                                      {d.docType}
                                    </span>
                                  ) : null}
                                  <span className="text-xs text-[var(--color-muted)]">
                                    {formatDate(d.uploadedAt, timeZone)}
                                  </span>
                                  <form action={deleteDocumentAction}>
                                    <input
                                      type="hidden"
                                      name="documentId"
                                      value={d.id}
                                    />
                                    <button
                                      type="submit"
                                      className="text-xs font-medium text-[var(--color-brand)] underline underline-offset-2"
                                    >
                                      Delete
                                    </button>
                                  </form>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-1 text-xs text-[var(--color-muted)]">
                              No documents yet.
                            </p>
                          )}

                          <form
                            action={uploadDocument}
                            encType="multipart/form-data"
                            className="mt-3 flex flex-wrap items-end gap-2"
                          >
                            <input type="hidden" name="id" value={s.id} />
                            <label className="block">
                              <span className="mb-1 block text-sm font-semibold">
                                Add a document
                              </span>
                              <input
                                type="file"
                                name="file"
                                required
                                aria-label={`Upload a document for ${s.name}`}
                                className="block max-w-full text-sm"
                              />
                            </label>
                            <label className="block">
                              <span className="mb-1 block text-sm font-semibold">
                                Type
                              </span>
                              <select
                                name="docType"
                                defaultValue="Other"
                                aria-label={`Document type for ${s.name}`}
                                className="rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2 text-sm"
                              >
                                {DOC_TYPES.map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <Button type="submit" variant="secondary">
                              Upload
                            </Button>
                          </form>
                          <p className="mt-1 text-xs text-[var(--color-muted)]">
                            Stored in your Google Drive (max 10 MB). Deleting
                            here also removes the file from your Drive.
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                  <form action={toggleActive}>
                    <input type="hidden" name="id" value={s.id} />
                    <input
                      type="hidden"
                      name="active"
                      value={String(s.active)}
                    />
                    <button
                      type="submit"
                      className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
                    >
                      {s.active ? "Remove" : "Add back"}
                    </button>
                  </form>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
