import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ownerRepo } from "@/lib/auth/context";
import { stockOverrideSchema } from "@/lib/validation";
import { stockStatusLabel } from "@/lib/labels";
import { formatDateTime } from "@/lib/time";
import { Banner, Button, Card, PageHeader } from "@/components/ui";

const PATH = "/app/stock";

const STATUS_BADGE: Record<string, string> = {
  available: "bg-[var(--color-ok)] text-white",
  low: "bg-[var(--color-warn)] text-white",
  needs_order: "bg-[var(--color-danger)] text-white",
};

const STATUS_OPTIONS = [
  { value: "available", label: "In stock" },
  { value: "low", label: "Running low" },
  { value: "needs_order", label: "Needs ordering" },
] as const;

type StatusRow = Awaited<
  ReturnType<Awaited<ReturnType<typeof ownerRepo>>["itemsWithCurrentStatus"]>
>[number];

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const sp = await searchParams;
  const repo = await ownerRepo();
  const business = await repo.getBusiness();
  const tz = business?.timezone;
  const rows = await repo.itemsWithCurrentStatus();

  async function setStatus(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const parsed = stockOverrideSchema.safeParse({
      itemId: formData.get("itemId"),
      status: formData.get("status"),
      quantity: formData.get("quantity") ?? "",
    });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Please check the form";
      redirect(`${PATH}?error=${encodeURIComponent(msg)}`);
    }
    const { itemId, status, quantity } = parsed.data;
    // checkedByStaffId null = owner-set. recordStockCheck validates the item
    // belongs to this business and is active.
    const n = await repo.recordStockCheck(
      [
        {
          itemId,
          status,
          quantity: quantity && quantity.length > 0 ? quantity : null,
        },
      ],
      { checkedByStaffId: null },
    );
    if (n === 0)
      redirect(`${PATH}?error=${encodeURIComponent("Item not found")}`);
    revalidatePath(PATH);
    redirect(`${PATH}?saved=1`);
  }

  // Group by supplier (rows are already supplier-then-name ordered).
  const groups: Array<{ supplier: string; rows: StatusRow[] }> = [];
  for (const row of rows) {
    const supplier = row.supplierName ?? "No supplier";
    const last = groups[groups.length - 1];
    if (last && last.supplier === supplier) last.rows.push(row);
    else groups.push({ supplier, rows: [row] });
  }

  const needsAttention = rows.filter(
    (r) => r.status === "low" || r.status === "needs_order",
  ).length;

  return (
    <>
      <PageHeader
        title="Stock"
        subtitle="What's running low or needs ordering, from staff stock checks. You'll get a reminder email on each supplier's order-by day. This flags stock only — it never places orders."
      />

      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}
      {sp.saved ? <Banner tone="success">Stock status updated.</Banner> : null}

      {rows.length === 0 ? (
        <Card className="mt-4 text-[var(--color-muted)]">
          No active items yet. Add items under{" "}
          <a
            href="/app/items"
            className="font-medium text-[var(--color-brand)] underline underline-offset-2"
          >
            Items
          </a>
          , then staff can check stock from the kiosk or their phone.
        </Card>
      ) : (
        <>
          <p className="mt-4 text-sm text-[var(--color-muted)]">
            {needsAttention === 0
              ? "Nothing flagged right now."
              : `${needsAttention} item${needsAttention === 1 ? "" : "s"} running low or needing an order.`}
          </p>

          {groups.map((group) => (
            <section
              key={group.supplier}
              className="mt-6"
              aria-label={group.supplier}
            >
              <h2 className="mb-2 text-lg font-semibold">{group.supplier}</h2>
              <ul className="space-y-2">
                {group.rows.map((r) => (
                  <li key={r.itemId}>
                    <Card className="py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold">
                            {r.name}
                            {r.unit ? (
                              <span className="ml-1 font-normal text-[var(--color-muted)]">
                                ({r.unit})
                              </span>
                            ) : null}
                          </p>
                          <p className="text-sm text-[var(--color-muted)]">
                            {r.checkedAt
                              ? `Last checked ${formatDateTime(r.checkedAt, tz)} by ${
                                  r.checkedByName ?? "Manager"
                                }`
                              : "Not checked yet"}
                            {r.quantity ? ` · ${r.quantity} left` : ""}
                          </p>
                        </div>
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-semibold ${
                            r.status
                              ? STATUS_BADGE[r.status]
                              : "bg-[var(--color-line)] text-[var(--color-muted)]"
                          }`}
                        >
                          {stockStatusLabel(r.status)}
                        </span>
                      </div>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-sm font-medium text-[var(--color-brand)]">
                          Set status
                        </summary>
                        <form
                          action={setStatus}
                          className="mt-3 flex flex-wrap items-end gap-2"
                        >
                          <input type="hidden" name="itemId" value={r.itemId} />
                          <label className="block">
                            <span className="mb-1 block text-sm font-semibold">
                              Status
                            </span>
                            <select
                              name="status"
                              defaultValue={r.status ?? "available"}
                              aria-label={`${r.name} status`}
                              className="block rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-base"
                            >
                              {STATUS_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-sm font-semibold">
                              How much left? (optional)
                            </span>
                            <input
                              name="quantity"
                              maxLength={40}
                              defaultValue={r.quantity ?? ""}
                              placeholder="e.g. 2 boxes"
                              className="block rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-base"
                            />
                          </label>
                          <Button type="submit" variant="secondary">
                            Save
                          </Button>
                        </form>
                      </details>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </>
  );
}
