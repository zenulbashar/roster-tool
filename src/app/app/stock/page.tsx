import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ownerRepo } from "@/lib/auth/context";
import { stockOverrideSchema } from "@/lib/validation";
import { businessDateOf, formatDateTime } from "@/lib/time";
import {
  Avatar,
  Badge,
  type BadgeTone,
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  Icon,
  PageHeader,
  SectionCard,
  TextInput,
} from "@/components/ui";

const PATH = "/app/stock";

const STATUS_OPTIONS = [
  { value: "available", label: "In stock" },
  { value: "low", label: "Running low" },
  { value: "needs_order", label: "Needs ordering" },
] as const;

const STATUS_BADGE: Record<string, { tone: BadgeTone; label: string }> = {
  available: { tone: "ok", label: "OK" },
  low: { tone: "warning", label: "Low" },
  needs_order: { tone: "danger", label: "Needs order" },
};

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

  // Read-only: which suppliers have an active order reminder (used only to show
  // a "reminder sent" sub-note next to flagged items).
  const today = businessDateOf(new Date(), tz);
  const reminderSuppliers = await repo.listSuppliersForReminder();
  const remindedSupplierIds = new Set(
    reminderSuppliers
      .filter(
        (s) => s.lastOrderReminderDate && s.lastOrderReminderDate >= today,
      )
      .map((s) => s.id),
  );

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

  const needsOrder = rows.filter((r) => r.status === "needs_order").length;

  const th =
    "px-[18px] py-[11px] font-archivo text-[10.5px] font-bold uppercase tracking-[0.05em] text-[#9CA3AF]";
  const td = "px-[18px] py-3 align-middle border-b border-[#F3F4F6]";

  function checkedByCell(r: StatusRow) {
    if (!r.checkedAt) return <span className="text-[#9CA3AF]">—</span>;
    if (!r.checkedByStaffId)
      return <span className="text-[#374151]">Manager</span>;
    const name = r.checkedByName ?? "Manager";
    return (
      <span className="inline-flex items-center gap-2 text-[#374151]">
        <Avatar name={name} colorKey={r.checkedByStaffId} size={22} />
        {name}
      </span>
    );
  }

  return (
    <>
      <PageHeader
        title="Stock levels"
        subtitle="Results from staff stock checks. Items running low or flagged for ordering show here. You'll get a reminder email on each supplier's order-by day. This flags stock only — it never places orders."
        action={
          needsOrder > 0 ? (
            <span className="inline-flex items-center gap-[7px] rounded-full border border-[#FECACA] bg-[#FEECEC] px-[13px] py-[7px] font-archivo text-[12.5px] font-bold text-[#B91C1C]">
              <Icon name="error" className="text-[16px]" />
              {needsOrder} need ordering
            </span>
          ) : undefined
        }
      />

      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}
      {sp.saved ? <Banner tone="success">Stock status updated.</Banner> : null}

      {rows.length === 0 ? (
        <Card className="mt-4" padded={false}>
          <EmptyState icon="inventory_2" title="No active items yet">
            Add items under{" "}
            <a
              href="/app/items"
              className="font-medium text-[var(--color-brand)] underline underline-offset-2"
            >
              Items
            </a>
            , then staff can check stock from the kiosk or their phone.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card className="mt-4" padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-[#FAFBFC] text-left">
                    <th className={th}>Item</th>
                    <th className={th}>Supplier</th>
                    <th className={th}>Checked by</th>
                    <th className={th}>Checked at</th>
                    <th className={`${th} text-right`}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const badge = r.status ? STATUS_BADGE[r.status] : undefined;
                    const flagged = r.status === "needs_order";
                    const reminderSent =
                      flagged &&
                      r.supplierId != null &&
                      remindedSupplierIds.has(r.supplierId);
                    return (
                      <tr
                        key={r.itemId}
                        className={flagged ? "bg-[#FFFBFA]" : ""}
                      >
                        <td className={td}>
                          <span className="font-semibold text-[#111827]">
                            {r.name}
                          </span>
                          {r.unit ? (
                            <span className="ml-1 text-[#9CA3AF]">
                              ({r.unit})
                            </span>
                          ) : null}
                        </td>
                        <td className={`${td} text-[#6B7280]`}>
                          {r.supplierName ?? "No supplier"}
                        </td>
                        <td className={td}>{checkedByCell(r)}</td>
                        <td className={`${td} text-[#6B7280] tabular-nums`}>
                          {r.checkedAt ? formatDateTime(r.checkedAt, tz) : "—"}
                          {r.quantity ? (
                            <span className="ml-1 text-[#9CA3AF]">
                              · {r.quantity} left
                            </span>
                          ) : null}
                        </td>
                        <td className={`${td} text-right`}>
                          <div className="flex flex-col items-end gap-[3px]">
                            {badge ? (
                              <Badge tone={badge.tone}>{badge.label}</Badge>
                            ) : (
                              <span className="text-[#9CA3AF]">—</span>
                            )}
                            {reminderSent ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#5A7D17]">
                                <Icon
                                  name="mark_email_read"
                                  className="text-[13px]"
                                />
                                Order reminder sent
                              </span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <SectionCard title="Set status manually" className="mt-6">
            <p className="mb-3 text-[13px] text-[var(--color-muted)]">
              Update an item without waiting for a staff check. Owner-set
              updates show as “Manager”.
            </p>
            <ul className="divide-y divide-[var(--color-border-subtle)]">
              {rows.map((r) => (
                <li key={r.itemId} className="py-2 first:pt-0 last:pb-0">
                  <details>
                    <summary className="flex cursor-pointer items-center justify-between gap-3 text-[13px] font-medium text-[var(--color-text)]">
                      <span>
                        {r.name}
                        {r.unit ? (
                          <span className="ml-1 font-normal text-[var(--color-muted)]">
                            ({r.unit})
                          </span>
                        ) : null}
                      </span>
                      <span className="text-[12px] text-[var(--color-brand)]">
                        Set status
                      </span>
                    </summary>
                    <form
                      action={setStatus}
                      className="mt-3 flex flex-wrap items-end gap-3"
                    >
                      <input type="hidden" name="itemId" value={r.itemId} />
                      <Field label="Status">
                        <select
                          name="status"
                          defaultValue={r.status ?? "available"}
                          aria-label={`${r.name} status`}
                          className="block rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-[14px] py-[11px] text-[14.5px] text-[var(--color-ink)]"
                        >
                          {STATUS_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="How much left? (optional)">
                        <TextInput
                          name="quantity"
                          maxLength={40}
                          defaultValue={r.quantity ?? ""}
                          placeholder="e.g. 2 boxes"
                        />
                      </Field>
                      <Button type="submit" variant="secondary">
                        Save
                      </Button>
                    </form>
                  </details>
                </li>
              ))}
            </ul>
          </SectionCard>
        </>
      )}
    </>
  );
}
