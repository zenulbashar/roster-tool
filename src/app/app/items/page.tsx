import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ownerRepo } from "@/lib/auth/context";
import { itemSchema } from "@/lib/validation";
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  Field,
  PageHeader,
  TextInput,
} from "@/components/ui";

const PATH = "/app/items";

function parseItemForm(formData: FormData) {
  const supplierRaw = formData.get("supplierId");
  const supplierId =
    typeof supplierRaw === "string" && supplierRaw.length > 0
      ? supplierRaw
      : null;
  return itemSchema.safeParse({
    name: formData.get("name"),
    skuCode: formData.get("skuCode") ?? "",
    unit: formData.get("unit") ?? "",
    supplierId,
  });
}

function cleanItem(data: ReturnType<typeof itemSchema.parse>) {
  const opt = (v: string | undefined) => (v && v.length > 0 ? v : null);
  return {
    name: data.name,
    skuCode: opt(data.skuCode),
    unit: opt(data.unit),
    supplierId: data.supplierId ?? null,
  };
}

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    added?: string;
    updated?: string;
    deleted?: string;
    activated?: string;
    deactivated?: string;
  }>;
}) {
  const sp = await searchParams;
  const repo = await ownerRepo();
  const [items, suppliers] = await Promise.all([
    repo.listItems(),
    repo.listSuppliers(),
  ]);

  async function addItem(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const parsed = parseItemForm(formData);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Please check the form";
      redirect(`${PATH}?error=${encodeURIComponent(msg)}`);
    }
    await repo.addItem(cleanItem(parsed.data));
    revalidatePath(PATH);
    redirect(`${PATH}?added=1`);
  }

  async function editItem(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    const parsed = parseItemForm(formData);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Please check the form";
      redirect(`${PATH}?error=${encodeURIComponent(msg)}`);
    }
    const updated = await repo.updateItem(id, cleanItem(parsed.data));
    if (!updated)
      redirect(`${PATH}?error=${encodeURIComponent("Item not found")}`);
    revalidatePath(PATH);
    redirect(`${PATH}?updated=1`);
  }

  async function toggleActive(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    const isActive = formData.get("isActive") === "true";
    await repo.setItemActive(id, isActive);
    revalidatePath(PATH);
    redirect(`${PATH}?${isActive ? "activated" : "deactivated"}=1`);
  }

  async function deleteItem(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    await repo.deleteItem(id);
    revalidatePath(PATH);
    redirect(`${PATH}?deleted=1`);
  }

  function supplierSelect(defaultValue: string | null) {
    return (
      <select
        name="supplierId"
        defaultValue={defaultValue ?? ""}
        aria-label="Supplier"
        className="block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-base"
      >
        <option value="">No supplier</option>
        {suppliers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    );
  }

  return (
    <>
      <PageHeader
        title="Items"
        subtitle="The products / SKUs you keep in stock. Record-keeping only — no stock counts or ordering yet (those come in a later update)."
        action={
          <ButtonLink href="/app/items/import" variant="secondary">
            Import from CSV
          </ButtonLink>
        }
      />

      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}
      {sp.added ? <Banner tone="success">Item added.</Banner> : null}
      {sp.updated ? <Banner tone="success">Item updated.</Banner> : null}
      {sp.deleted ? <Banner tone="success">Item removed.</Banner> : null}
      {sp.activated ? <Banner tone="success">Item reactivated.</Banner> : null}
      {sp.deactivated ? (
        <Banner tone="success">Item deactivated.</Banner>
      ) : null}

      <section className="mt-4" aria-label="Items">
        <h2 className="mb-3 text-lg font-semibold">
          Your items ({items.length})
        </h2>
        {items.length === 0 ? (
          <p className="text-[var(--color-muted)]">
            None yet. Add one below, or{" "}
            <a
              href="/app/items/import"
              className="font-medium text-[var(--color-brand)] underline underline-offset-2"
            >
              import a CSV
            </a>
            .
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((it) => (
              <li key={it.id}>
                <Card className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">
                        {it.name}
                        {it.isActive ? null : (
                          <span className="ml-2 rounded bg-[var(--color-line)] px-2 py-0.5 text-xs font-semibold text-[var(--color-muted)]">
                            Inactive
                          </span>
                        )}
                      </p>
                      <p className="text-sm text-[var(--color-muted)]">
                        {it.skuCode ? `SKU ${it.skuCode}` : "No SKU"}
                        {it.unit ? ` · ${it.unit}` : ""}
                        {it.supplierName ? ` · ${it.supplierName}` : ""}
                      </p>
                    </div>
                    <form action={toggleActive}>
                      <input type="hidden" name="id" value={it.id} />
                      <input
                        type="hidden"
                        name="isActive"
                        value={it.isActive ? "false" : "true"}
                      />
                      <button
                        type="submit"
                        className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
                      >
                        {it.isActive ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-medium text-[var(--color-brand)]">
                      Edit / remove
                    </summary>
                    <form action={editItem} className="mt-3 space-y-3">
                      <input type="hidden" name="id" value={it.id} />
                      <Field label="Name">
                        <TextInput
                          name="name"
                          defaultValue={it.name}
                          required
                          maxLength={200}
                        />
                      </Field>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="SKU code (optional)">
                          <TextInput
                            name="skuCode"
                            defaultValue={it.skuCode ?? ""}
                            maxLength={80}
                          />
                        </Field>
                        <Field label="Unit (optional)">
                          <TextInput
                            name="unit"
                            defaultValue={it.unit ?? ""}
                            maxLength={40}
                          />
                        </Field>
                      </div>
                      <Field label="Supplier">
                        {supplierSelect(it.supplierId)}
                      </Field>
                      <Button type="submit" variant="secondary">
                        Save changes
                      </Button>
                    </form>
                    <form action={deleteItem} className="mt-2">
                      <input type="hidden" name="id" value={it.id} />
                      <button
                        type="submit"
                        className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
                      >
                        Remove item
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
        <h2 className="text-lg font-semibold">Add an item</h2>
        <form action={addItem} className="mt-3 space-y-3">
          <Field label="Name">
            <TextInput name="name" required maxLength={200} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="SKU code (optional)">
              <TextInput name="skuCode" maxLength={80} />
            </Field>
            <Field label="Unit (optional)" hint="e.g. kg, box, each">
              <TextInput name="unit" maxLength={40} />
            </Field>
          </div>
          <Field label="Supplier">{supplierSelect(null)}</Field>
          <Button type="submit">Add item</Button>
        </form>
      </Card>
    </>
  );
}
