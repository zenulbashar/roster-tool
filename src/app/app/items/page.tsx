import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ownerRepo } from "@/lib/auth/context";
import { itemSchema } from "@/lib/validation";
import {
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

const COLS = "1.6fr 1fr 1fr 1.4fr 0.9fr 0.8fr";

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
        className="block w-full rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-[14px] py-[11px] text-[14.5px] text-[var(--color-ink)]"
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
        subtitle="Your product catalogue — SKUs, suppliers and units. Record-keeping only — no stock counts or ordering yet (those come in a later update)."
        action={
          <div className="flex gap-2.5">
            <ButtonLink href="/app/items/import" variant="secondary">
              <Icon name="upload_file" className="text-[18px]" />
              Import from CSV
            </ButtonLink>
            <ButtonLink href="#add-item">
              <Icon name="add" className="text-[19px]" />
              Add item
            </ButtonLink>
          </div>
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

      {items.length === 0 ? (
        <Card className="mt-1 text-center">
          <p className="text-[13.5px] text-[var(--color-text-muted)]">
            No items yet. Add one below, or{" "}
            <a
              href="/app/items/import"
              className="font-medium text-[var(--color-brand)] underline underline-offset-2"
            >
              import a CSV
            </a>
            .
          </p>
        </Card>
      ) : (
        <Card padded={false} className="mt-1">
          <div className="overflow-x-auto">
            <div className="min-w-[840px]">
              {/* Header row */}
              <div
                className="grid items-center gap-0 border-b border-[var(--color-border)] bg-[#FAFBFC] px-[18px] py-[11px] font-archivo text-[10.5px] font-bold uppercase tracking-[0.05em] text-[#9CA3AF]"
                style={{ gridTemplateColumns: COLS }}
              >
                <span>Item</span>
                <span>SKU</span>
                <span>Category</span>
                <span>Supplier</span>
                <span className="text-right">Reorder</span>
                <span className="text-right">Unit</span>
              </div>

              {items.map((it) => (
                <details
                  key={it.id}
                  className="group border-b border-[#F3F4F6]"
                >
                  <summary
                    className="grid cursor-pointer list-none items-center gap-0 px-[18px] py-[11px] text-[13px] marker:content-none hover:bg-[#FAFBFC] [&::-webkit-details-marker]:hidden"
                    style={{ gridTemplateColumns: COLS }}
                  >
                    <span className="flex items-center gap-2 font-semibold text-[#111827]">
                      {it.name}
                      {it.isActive ? null : (
                        <Badge tone="draft">Inactive</Badge>
                      )}
                    </span>
                    <span className="font-mono text-[12px] text-[#6B7280]">
                      {it.skuCode || "—"}
                    </span>
                    <span className="text-[#9CA3AF]">—</span>
                    <span className="text-[#6B7280]">
                      {it.supplierName || "—"}
                    </span>
                    <span className="text-right text-[#9CA3AF]">—</span>
                    <span className="text-right text-[#9CA3AF]">
                      {it.unit || "—"}
                    </span>
                  </summary>

                  {/* Per-row edit / remove / (de)activate */}
                  <div className="border-t border-[#F3F4F6] bg-[#FAFBFC] px-[18px] py-4">
                    <form action={editItem} className="space-y-3">
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
                    <div className="mt-3 flex items-center gap-4 border-t border-[#F3F4F6] pt-3">
                      <form action={toggleActive}>
                        <input type="hidden" name="id" value={it.id} />
                        <input
                          type="hidden"
                          name="isActive"
                          value={it.isActive ? "false" : "true"}
                        />
                        <button
                          type="submit"
                          className="text-[13px] font-medium text-[var(--color-brand)] underline underline-offset-2"
                        >
                          {it.isActive ? "Deactivate" : "Reactivate"}
                        </button>
                      </form>
                      <form action={deleteItem}>
                        <input type="hidden" name="id" value={it.id} />
                        <button
                          type="submit"
                          className="text-[13px] font-medium text-[var(--color-danger)] underline underline-offset-2"
                        >
                          Remove item
                        </button>
                      </form>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </div>
        </Card>
      )}

      <p className="mt-2.5 text-[12px] text-[var(--color-text-muted)]">
        Categories &amp; reorder thresholds are coming soon.
      </p>

      <Card id="add-item" className="mt-6">
        <h2 className="font-archivo text-[15px] font-bold text-[var(--color-ink)]">
          Add an item
        </h2>
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
