import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ownerRepo } from "@/lib/auth/context";
import { supplierSchema, WEEKDAY_OPTIONS } from "@/lib/validation";
import { WEEKDAY_SHORT_LABEL, weekdaysLabel } from "@/lib/labels";
import {
  Banner,
  Button,
  Card,
  Field,
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

  return (
    <>
      <PageHeader
        title="Suppliers"
        subtitle="Who you order stock from and which days they deliver. This is record-keeping only — the app doesn't place orders or connect to any supplier system."
      />

      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}
      {sp.added ? <Banner tone="success">Supplier added.</Banner> : null}
      {sp.updated ? <Banner tone="success">Supplier updated.</Banner> : null}
      {sp.deleted ? <Banner tone="success">Supplier removed.</Banner> : null}

      <section className="mt-4" aria-label="Suppliers">
        <h2 className="mb-3 text-lg font-semibold">
          Your suppliers ({suppliers.length})
        </h2>
        {suppliers.length === 0 ? (
          <p className="text-[var(--color-muted)]">
            None yet. Add your first supplier below.
          </p>
        ) : (
          <ul className="space-y-2">
            {suppliers.map((s) => (
              <li key={s.id}>
                <Card className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{s.name}</p>
                      <p className="text-sm text-[var(--color-muted)]">
                        Delivers {weekdaysLabel(s.deliveryDays)}
                        {" · "}order {s.orderCutoffDaysBefore} day
                        {s.orderCutoffDaysBefore === 1 ? "" : "s"} before
                        {s.contactName ? ` · ${s.contactName}` : ""}
                        {s.email ? ` · ${s.email}` : ""}
                        {s.phone ? ` · ${s.phone}` : ""}
                      </p>
                    </div>
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-medium text-[var(--color-brand)]">
                      Edit / remove
                    </summary>
                    <form action={editSupplier} className="mt-3 space-y-3">
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
                      <div className="flex items-center gap-4">
                        <Button type="submit" variant="secondary">
                          Save changes
                        </Button>
                      </div>
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
                  </details>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card className="mt-8">
        <h2 className="text-lg font-semibold">Add a supplier</h2>
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
