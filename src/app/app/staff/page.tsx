import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ownerRepo } from "@/lib/auth/context";
import { staffSchema, pinSchema, payRateSchema } from "@/lib/validation";
import { hashPin } from "@/lib/pin";
import {
  Banner,
  Button,
  Card,
  Field,
  PageHeader,
  TextInput,
} from "@/components/ui";

const PATH = "/app/staff";

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
  }>;
}) {
  const sp = await searchParams;
  const repo = await ownerRepo();
  const staff = await repo.listStaff();

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
