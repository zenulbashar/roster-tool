import Link from "next/link";
import { createTenantRepo } from "@/lib/tenant/repository";
import { verifiedNoticesStaff } from "@/lib/notices-session";
import { Card } from "@/components/ui";
import { StaffFormFill } from "@/components/StaffFormFill";
import { submitInternalForm } from "./actions";

export const dynamic = "force-dynamic";

/**
 * A staff member fills one INTERNAL form from their PIN-gated portal. The /me
 * gate (`verifiedNoticesStaff`: capability cookie + HMAC PIN proof) identifies
 * the staff member server-side; the form is loaded ONLY when it's this
 * business's AND internal_enabled. For an ATTRIBUTED form already answered by
 * this person we show "already responded" instead of the form (the authoritative
 * block is the partial-unique in the store). Only the safe field projection
 * reaches the client.
 */
export default async function StaffFormFillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const staff = await verifiedNoticesStaff();
  if (!staff) {
    return (
      <Card className="text-center">
        <h1 className="text-xl font-bold">Please sign in</h1>
        <p className="mt-2 text-[var(--color-muted)]">
          Open your personal link and enter your PIN to fill in forms.
        </p>
      </Card>
    );
  }

  const repo = createTenantRepo(staff.businessId);
  const data = await repo.getInternalFormForStaff(id);
  if (!data) {
    return (
      <Card className="text-center">
        <h1 className="text-xl font-bold">Form not available</h1>
        <p className="mt-2 text-[var(--color-muted)]">
          This form isn&rsquo;t available to fill in right now.
        </p>
        <p className="mt-4">
          <Link
            href="/me"
            className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
          >
            ← Back to your notices
          </Link>
        </p>
      </Card>
    );
  }

  // Attributed forms: if this person already responded, show that instead of the
  // form (UX — the store still blocks a duplicate authoritatively).
  if (!data.form.allowAnonymous) {
    const already = await repo.hasStaffRespondedToForm(id, staff.staffMemberId);
    if (already) {
      return (
        <Card className="text-center">
          <h1 className="text-2xl font-bold">Already responded</h1>
          <p className="mt-2 text-[var(--color-muted)]">
            You&rsquo;ve already filled in &ldquo;{data.form.title}&rdquo;.
            Thanks!
          </p>
          <p className="mt-4">
            <Link
              href="/me"
              className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
            >
              ← Back to your notices
            </Link>
          </p>
        </Card>
      );
    }
  }

  const fields = data.fields.map((f) => ({
    id: f.id,
    label: f.label,
    type: f.type,
    required: f.required,
    options: (f.options ?? []).map((o) => ({ id: o.id, label: o.label })),
  }));

  return (
    <>
      <div className="mb-3">
        <Link
          href="/me"
          className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
        >
          ← Back to your notices
        </Link>
      </div>
      <StaffFormFill
        formId={id}
        title={data.form.title}
        description={data.form.description}
        anonymous={data.form.allowAnonymous}
        fields={fields}
        action={submitInternalForm}
      />
    </>
  );
}
