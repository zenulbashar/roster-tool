import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ownerRepo } from "@/lib/auth/context";
import {
  certificationSchema,
  parseCertLeadDays,
  CERT_LEAD_DAYS_OPTIONS,
} from "@/lib/validation";
import { certStatus, daysUntil, type CertStatus } from "@/lib/certification";
import { CERT_TYPE_LABEL, certDisplayLabel } from "@/lib/labels";
import { businessDateOf, formatDateOnly } from "@/lib/time";
import {
  Avatar,
  Badge,
  Banner,
  Button,
  ButtonLink,
  Card,
  Field,
  Icon,
  PageHeader,
  TextInput,
} from "@/components/ui";
import type { BadgeTone } from "@/components/ui";

const PATH = "/app/certifications";

const CERT_TYPES = Object.entries(CERT_TYPE_LABEL) as Array<[string, string]>;

const STATUS_META: Record<
  CertStatus,
  { label: string; tone: BadgeTone; icon: string; iconClass: string }
> = {
  valid: {
    label: "Valid",
    tone: "success",
    icon: "check_circle",
    iconClass: "text-[#16A34A]",
  },
  expiring: {
    label: "Expiring soon",
    tone: "warning",
    icon: "warning",
    iconClass: "text-[#D97706]",
  },
  expired: {
    label: "Expired",
    tone: "danger",
    icon: "cancel",
    iconClass: "text-[#DC2626]",
  },
};

function parseCertForm(formData: FormData) {
  return certificationSchema.safeParse({
    certType: formData.get("certType"),
    certLabel: formData.get("certLabel") ?? "",
    referenceNumber: formData.get("referenceNumber") ?? "",
    expiryDate: formData.get("expiryDate"),
  });
}

export default async function CertificationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    added?: string;
    updated?: string;
    deleted?: string;
    lead?: string;
    filter?: string;
  }>;
}) {
  const sp = await searchParams;
  const repo = await ownerRepo();
  const business = await repo.getBusiness();
  const leadDays = business?.certReminderLeadDays ?? 30;
  const today = businessDateOf(new Date(), business?.timezone);

  const [certs, staff] = await Promise.all([
    repo.listCertifications(),
    repo.listStaff({ activeOnly: true }),
  ]);

  async function addCert(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const staffMemberId = String(formData.get("staffMemberId"));
    const parsed = parseCertForm(formData);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Please check the form";
      redirect(`${PATH}?error=${encodeURIComponent(msg)}`);
    }
    const { certType, certLabel, referenceNumber, expiryDate } = parsed.data;
    const created = await repo.addCertification({
      staffMemberId,
      certType,
      certLabel: certLabel && certLabel.length > 0 ? certLabel : null,
      referenceNumber:
        referenceNumber && referenceNumber.length > 0 ? referenceNumber : null,
      expiryDate,
    });
    if (!created)
      redirect(`${PATH}?error=${encodeURIComponent("Pick a team member")}`);
    revalidatePath(PATH);
    redirect(`${PATH}?added=1`);
  }

  async function editCert(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    const parsed = parseCertForm(formData);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Please check the form";
      redirect(`${PATH}?error=${encodeURIComponent(msg)}`);
    }
    const { certType, certLabel, referenceNumber, expiryDate } = parsed.data;
    const updated = await repo.updateCertification(id, {
      certType,
      certLabel: certLabel && certLabel.length > 0 ? certLabel : null,
      referenceNumber:
        referenceNumber && referenceNumber.length > 0 ? referenceNumber : null,
      expiryDate,
    });
    if (!updated)
      redirect(
        `${PATH}?error=${encodeURIComponent("Certification not found")}`,
      );
    revalidatePath(PATH);
    redirect(`${PATH}?updated=1`);
  }

  async function deleteCert(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    await repo.deleteCertification(id);
    revalidatePath(PATH);
    redirect(`${PATH}?deleted=1`);
  }

  async function setLeadDays(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const days = parseCertLeadDays(formData.get("leadDays"));
    if (days === null)
      redirect(`${PATH}?error=${encodeURIComponent("Pick a valid lead time")}`);
    await repo.updateBusinessSettings({ certReminderLeadDays: days });
    revalidatePath(PATH);
    redirect(`${PATH}?lead=1`);
  }

  function certTypeSelect(name: string, defaultValue?: string) {
    return (
      <select
        name={name}
        defaultValue={defaultValue ?? "rsa"}
        aria-label="Certification type"
        className="block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-base"
      >
        {CERT_TYPES.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    );
  }

  const attentionOnly = sp.filter === "attention";
  const rows = certs
    .map((c) => ({
      cert: c,
      status: certStatus(c.expiryDate, today, leadDays),
      days: daysUntil(c.expiryDate, today),
    }))
    .filter((r) => (attentionOnly ? r.status !== "valid" : true));

  return (
    <>
      <PageHeader
        title="Certifications"
        subtitle="RSA, Food Safety, First Aid — tracked per staff so nothing lapses on a shift. This flags expiry only — it never blocks rostering or clock-in, and no documents are stored."
        action={
          <span className="inline-flex items-center gap-[7px] rounded-[20px] border border-[#CFE3D6] bg-[#ECF3EE] px-[13px] py-[7px] text-[12px] font-semibold text-[#13301F]">
            <Icon name="mark_email_read" className="text-[16px]" />
            Reminder emails sent automatically
          </span>
        }
      />

      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}
      {sp.added ? <Banner tone="success">Certification added.</Banner> : null}
      {sp.updated ? (
        <Banner tone="success">Certification updated.</Banner>
      ) : null}
      {sp.deleted ? (
        <Banner tone="success">Certification removed.</Banner>
      ) : null}
      {sp.lead ? (
        <Banner tone="success">Reminder lead time saved.</Banner>
      ) : null}

      <div className="mb-[14px] flex flex-wrap items-center gap-3">
        <ButtonLink
          href={attentionOnly ? PATH : `${PATH}?filter=attention`}
          variant={attentionOnly ? "primary" : "secondary"}
          aria-pressed={attentionOnly}
        >
          <Icon name="filter_alt" className="text-[18px]" />
          Show expiring &amp; expired only
        </ButtonLink>
        {attentionOnly ? (
          <span className="text-[12.5px] font-semibold text-[#B45309]">
            Showing items that need attention
          </span>
        ) : null}
      </div>

      <Card padded={false} aria-label="Team certifications">
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[1.5fr_1.1fr_1fr_1.2fr_0.9fr] items-center gap-0 border-b border-[var(--color-border)] bg-[#FAFBFC] px-[18px] py-[11px] font-archivo text-[10.5px] font-bold uppercase tracking-[0.05em] text-[#9CA3AF]">
              <span>Staff</span>
              <span>Certification</span>
              <span>Expiry</span>
              <span>Status</span>
              <span className="text-right">Days left</span>
            </div>
            {rows.length === 0 ? (
              <p className="px-[18px] py-8 text-center text-[13px] text-[var(--color-text-muted)]">
                {attentionOnly
                  ? "Nothing needs attention right now."
                  : "None yet. Add your team’s qualifications below."}
              </p>
            ) : (
              rows.map(({ cert: c, status, days }) => {
                const meta = STATUS_META[status];
                return (
                  <div
                    key={c.id}
                    className="grid grid-cols-[1.5fr_1.1fr_1fr_1.2fr_0.9fr] items-center gap-0 border-b border-[#F3F4F6] px-[18px] py-[12px] text-[13px]"
                  >
                    <div className="flex min-w-0 items-center gap-[10px]">
                      <Avatar name={c.staffName} size={28} />
                      <span className="truncate font-semibold text-[#111827]">
                        {c.staffName}
                      </span>
                    </div>
                    <span className="font-medium text-[#374151]">
                      {certDisplayLabel(c.certType, c.certLabel)}
                    </span>
                    <span className="tabular-nums text-[#6B7280]">
                      {formatDateOnly(c.expiryDate)}
                    </span>
                    <span className="inline-flex items-center gap-[7px]">
                      <Icon
                        name={meta.icon}
                        className={`text-[18px] ${meta.iconClass}`}
                        fill
                      />
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </span>
                    <span className="text-right tabular-nums text-[#6B7280]">
                      {days} {Math.abs(days) === 1 ? "day" : "days"}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </Card>

      <Card className="mt-8">
        <form
          action={setLeadDays}
          className="flex flex-wrap items-end gap-3"
          aria-label="Reminder lead time"
        >
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">
              First reminder
            </span>
            <select
              name="leadDays"
              defaultValue={String(leadDays)}
              aria-label="Reminder lead time in days"
              className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
            >
              {CERT_LEAD_DAYS_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d} days before expiry
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="secondary">
            Save
          </Button>
          <p className="text-sm text-[var(--color-muted)]">
            A final reminder always goes out 7 days before, and again on expiry.
          </p>
        </form>
      </Card>

      <section className="mt-8" aria-label="Edit certifications">
        <h2 className="mb-3 font-archivo text-lg font-bold text-[var(--color-text)]">
          Manage certifications ({certs.length})
        </h2>
        {certs.length === 0 ? (
          <p className="text-[var(--color-text-muted)]">
            None yet. Add your team&rsquo;s qualifications below.
          </p>
        ) : (
          <ul className="space-y-2">
            {certs.map((c) => (
              <li key={c.id}>
                <Card className="py-3">
                  <details>
                    <summary className="flex cursor-pointer items-center justify-between gap-3">
                      <span className="font-semibold text-[var(--color-text)]">
                        {c.staffName}
                        <span className="ml-2 font-normal text-[var(--color-text-muted)]">
                          {certDisplayLabel(c.certType, c.certLabel)}
                        </span>
                      </span>
                      <span className="text-sm text-[var(--color-text-muted)]">
                        Expires {formatDateOnly(c.expiryDate)}
                        {c.referenceNumber ? ` · Ref ${c.referenceNumber}` : ""}
                      </span>
                    </summary>
                    <div className="mt-3 flex flex-wrap items-end gap-3">
                      <form
                        action={editCert}
                        className="flex flex-wrap items-end gap-2"
                      >
                        <input type="hidden" name="id" value={c.id} />
                        <label className="block">
                          <span className="mb-1 block text-sm font-semibold">
                            Type
                          </span>
                          {certTypeSelect("certType", c.certType)}
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-sm font-semibold">
                            Label
                          </span>
                          <TextInput
                            name="certLabel"
                            defaultValue={c.certLabel ?? ""}
                            maxLength={120}
                            className="w-40"
                            aria-label="Certification label"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-sm font-semibold">
                            Reference
                          </span>
                          <TextInput
                            name="referenceNumber"
                            defaultValue={c.referenceNumber ?? ""}
                            maxLength={120}
                            className="w-36"
                            aria-label="Reference number"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-sm font-semibold">
                            Expiry
                          </span>
                          <TextInput
                            type="date"
                            name="expiryDate"
                            defaultValue={c.expiryDate}
                            required
                            aria-label="Expiry date"
                          />
                        </label>
                        <Button type="submit" variant="secondary">
                          Save
                        </Button>
                      </form>
                      <form action={deleteCert}>
                        <input type="hidden" name="id" value={c.id} />
                        <button
                          type="submit"
                          className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
                        >
                          Remove
                        </button>
                      </form>
                    </div>
                  </details>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card className="mt-8">
        <h2 className="font-archivo text-lg font-bold text-[var(--color-text)]">
          Add a certification
        </h2>
        {staff.length === 0 ? (
          <p className="mt-3 text-[var(--color-muted)]">
            Add a team member first.
          </p>
        ) : (
          <form action={addCert} className="mt-3 space-y-4">
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
            <Field label="Type">{certTypeSelect("certType")}</Field>
            <Field
              label="Label (required for Other)"
              hint="A name for the certification, e.g. 'Barista level 2'."
            >
              <TextInput name="certLabel" maxLength={120} />
            </Field>
            <Field label="Reference number (optional)">
              <TextInput name="referenceNumber" maxLength={120} />
            </Field>
            <Field label="Expiry date">
              <TextInput type="date" name="expiryDate" required />
            </Field>
            <Button type="submit">Add certification</Button>
          </form>
        )}
      </Card>
    </>
  );
}
