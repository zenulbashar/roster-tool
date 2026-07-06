import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ownerRepo } from "@/lib/auth/context";
import { supplierSchema, WEEKDAY_OPTIONS } from "@/lib/validation";
import { WEEKDAY_SHORT_LABEL } from "@/lib/labels";
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  Eyebrow,
  Field,
  Icon,
  PageHeader,
  TextInput,
} from "@/components/ui";

const PATH = "/app/suppliers";

function parseSupplierForm(formData: FormData) {
  const deliveryDays = formData
    .getAll("deliveryDays")
    .map((d) => Number(d))
    .filter((n) => Number.isInteger(n));
  return supplierSchema.safeParse({
    name: formData.get("name"),
    contactName: formData.get("contactName") ?? "",
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
    deliveryDays,
    orderCutoffDaysBefore: formData.get("orderCutoffDaysBefore") ?? "1",
    notes: formData.get("notes") ?? "",
  });
}

/** Normalise the optional string fields: "" → null. */
function cleanSupplier(data: ReturnType<typeof supplierSchema.parse>) {
  const opt = (v: string | undefined) => (v && v.length > 0 ? v : null);
  return {
    name: data.name,
    contactName: opt(data.contactName),
    email: opt(data.email),
    phone: opt(data.phone),
    deliveryDays: data.deliveryDays,
    orderCutoffDaysBefore: data.orderCutoffDaysBefore,
    notes: opt(data.notes),
  };
}

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    added?: string;
    updated?: string;
    deleted?: string;
  }>;
}) {
  const sp = await searchParams;
  const repo = await ownerRepo();
  const suppliers = await repo.listSuppliers();

  async function addSupplier(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const parsed = parseSupplierForm(formData);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Please check the form";
      redirect(`${PATH}?error=${encodeURIComponent(msg)}`);
    }
    await repo.addSupplier(cleanSupplier(parsed.data));
    revalidatePath(PATH);
    redirect(`${PATH}?added=1`);
  }

  async function editSupplier(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    const parsed = parseSupplierForm(formData);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Please check the form";
      redirect(`${PATH}?error=${encodeURIComponent(msg)}`);
    }
    const updated = await repo.updateSupplier(id, cleanSupplier(parsed.data));
    if (!updated)
      redirect(`${PATH}?error=${encodeURIComponent("Supplier not found")}`);
    revalidatePath(PATH);
    redirect(`${PATH}?updated=1`);
  }

  async function deleteSupplier(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    await repo.deleteSupplier(id);
    revalidatePath(PATH);
    redirect(`${PATH}?deleted=1`);
  }

  function deliveryDayPicker(selected: number[]) {
    const set = new Set(selected);
    return (
      <fieldset className="flex flex-wrap gap-2" aria-label="Delivery days">
        {WEEKDAY_OPTIONS.map((d) => (
          <label
            key={d}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-line)] px-3 py-2 text-sm"
          >
            <input
              type="checkbox"
              name="deliveryDays"
              value={d}
              defaultChecked={set.has(d)}
            />
            {WEEKDAY_SHORT_LABEL[d]}
          </label>
        ))}
      </fieldset>
    );
  }

  /** Read-only Mon–Sun chip row: delivery days green, the rest muted. */
  function deliveryDayChips(selected: number[]) {
    const set = new Set(selected);
    return (
      <div className="flex flex-wrap gap-1.5">
        {WEEKDAY_OPTIONS.map((d) => {
          const on = set.has(d);
          return (
            <span
              key={d}
              className={`w-[38px] rounded-[7px] py-1.5 text-center font-archivo text-[11px] font-bold ${
                on
                  ? "bg-[#F0F6E2] text-[#5A7D17]"
                  : "border border-[#F1F3F5] bg-[#F9FAFB] text-[#CBD0D8]"
              }`}
            >
              {WEEKDAY_SHORT_LABEL[d]}
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Suppliers"
        subtitle="Who you order from and which days they deliver. Drives the daily order reminders. This is record-keeping only — the app doesn't place orders or connect to any supplier system."
        action={
          <ButtonLink href="#add-supplier">
            <Icon name="add" className="text-[19px]" />
            Add supplier
          </ButtonLink>
        }
      />

      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}
      {sp.added ? <Banner tone="success">Supplier added.</Banner> : null}
      {sp.updated ? <Banner tone="success">Supplier updated.</Banner> : null}
      {sp.deleted ? <Banner tone="success">Supplier removed.</Banner> : null}

      <section className="mt-4" aria-label="Suppliers">
        <div className="grid gap-4 md:grid-cols-2">
          {suppliers.map((s) => (
            <Card key={s.id}>
              <details className="group">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-[11px] bg-[#F4F8E9]"
                      >
                        <Icon
                          name="local_shipping"
                          className="text-[23px] text-[#5A7D17]"
                        />
                      </span>
                      <div>
                        <div className="font-archivo text-[16px] font-bold text-[#111827]">
                          {s.name}
                        </div>
                        {/* GAP: suppliers have no category field. */}
                        {s.contactName ? (
                          <div className="mt-0.5 text-[12.5px] text-[var(--color-text-muted)]">
                            {s.contactName}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <span
                      aria-hidden="true"
                      className="flex text-[#9CA3AF] transition-colors group-open:text-[#4D7C0F]"
                    >
                      <Icon name="edit" className="text-[19px]" />
                    </span>
                  </div>

                  <div className="mt-3.5 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 text-[13px] text-[#6B7280]">
                      <Icon
                        name="mail"
                        className="text-[17px] text-[#9CA3AF]"
                      />
                      {s.email ?? "No email"}
                    </div>
                    <div className="flex items-center gap-2 text-[13px] text-[#6B7280]">
                      <Icon
                        name="call"
                        className="text-[17px] text-[#9CA3AF]"
                      />
                      {s.phone ?? "No phone"}
                    </div>
                  </div>

                  <div className="mt-4">
                    <Eyebrow className="mb-2 block text-[#9CA3AF]">
                      Delivery days
                    </Eyebrow>
                    {deliveryDayChips(s.deliveryDays)}
                    <div className="mt-2 text-[12px] text-[var(--color-text-muted)]">
                      Order {s.orderCutoffDaysBefore} day
                      {s.orderCutoffDaysBefore === 1 ? "" : "s"} before delivery
                    </div>
                  </div>
                </summary>

                <div className="mt-4 border-t border-[var(--color-border-subtle)] pt-4">
                  <form action={editSupplier} className="space-y-3">
                    <input type="hidden" name="id" value={s.id} />
                    <Field label="Name">
                      <TextInput
                        name="name"
                        defaultValue={s.name}
                        required
                        maxLength={120}
                      />
                    </Field>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Contact name (optional)">
                        <TextInput
                          name="contactName"
                          defaultValue={s.contactName ?? ""}
                          maxLength={120}
                        />
                      </Field>
                      <Field label="Email (optional)">
                        <TextInput
                          type="email"
                          name="email"
                          defaultValue={s.email ?? ""}
                          maxLength={200}
                        />
                      </Field>
                      <Field label="Phone (optional)">
                        <TextInput
                          name="phone"
                          defaultValue={s.phone ?? ""}
                          maxLength={40}
                        />
                      </Field>
                      <Field label="Order by (days before delivery)">
                        <TextInput
                          type="number"
                          name="orderCutoffDaysBefore"
                          defaultValue={String(s.orderCutoffDaysBefore)}
                          min={0}
                          max={30}
                          required
                        />
                      </Field>
                    </div>
                    <Field label="Delivery days">
                      {deliveryDayPicker(s.deliveryDays)}
                    </Field>
                    <Field label="Notes (optional)">
                      <TextInput
                        name="notes"
                        defaultValue={s.notes ?? ""}
                        maxLength={1000}
                      />
                    </Field>
                    <Button type="submit" variant="secondary">
                      Save changes
                    </Button>
                  </form>
                  <form action={deleteSupplier} className="mt-2">
                    <input type="hidden" name="id" value={s.id} />
                    <button
                      type="submit"
                      className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
                    >
                      Remove supplier
                    </button>
                  </form>
                </div>
              </details>
            </Card>
          ))}

          {/* Dashed "Add a supplier" prompt → jumps to the full form below. */}
          <a
            href="#add-supplier"
            className="flex flex-col justify-center rounded-[var(--radius-card)] border-[1.5px] border-dashed border-[#D1D5DB] bg-[#FAFBFC] p-5 text-left transition-colors hover:border-[#76b900]"
          >
            <span className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-[#F4F8E9]"
              >
                <Icon name="add" className="text-[20px] text-[#5A7D17]" />
              </span>
              <span className="font-archivo text-[15px] font-bold text-[#111827]">
                Add a supplier
              </span>
            </span>
            <span className="mt-2 text-[13px] text-[var(--color-text-muted)]">
              Add who you order from and their delivery days.
            </span>
          </a>
        </div>
      </section>

      <Card id="add-supplier" className="mt-8 scroll-mt-6">
        <h2 className="font-archivo text-lg font-bold text-[#111827]">
          Add a supplier
        </h2>
        <form action={addSupplier} className="mt-3 space-y-3">
          <Field label="Name">
            <TextInput name="name" required maxLength={120} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Contact name (optional)">
              <TextInput name="contactName" maxLength={120} />
            </Field>
            <Field label="Email (optional)">
              <TextInput type="email" name="email" maxLength={200} />
            </Field>
            <Field label="Phone (optional)">
              <TextInput name="phone" maxLength={40} />
            </Field>
            <Field
              label="Order by (days before delivery)"
              hint="Used for order reminders in a later update; saved now."
            >
              <TextInput
                type="number"
                name="orderCutoffDaysBefore"
                defaultValue="1"
                min={0}
                max={30}
                required
              />
            </Field>
          </div>
          <Field label="Delivery days">{deliveryDayPicker([])}</Field>
          <Field label="Notes (optional)">
            <TextInput name="notes" maxLength={1000} />
          </Field>
          <Button type="submit">Add supplier</Button>
        </form>
      </Card>
    </>
  );
}
