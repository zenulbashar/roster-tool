"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { StockCheckResult } from "@/lib/stock-check-submission";
import { Banner } from "@/components/ui";
import { kioskCls, KioskSuccess } from "@/components/KioskForm";

const initial: StockCheckResult = { status: "idle" };

export type StockCheckItem = {
  id: string;
  name: string;
  unit: string | null;
  supplierName: string | null;
};

const STATUS_OPTIONS = [
  { value: "", label: "Leave unchanged" },
  { value: "available", label: "In stock" },
  { value: "low", label: "Running low" },
  { value: "needs_order", label: "Needs ordering" },
] as const;

/** Group items (already supplier-then-name sorted) by supplier for display. */
function groupBySupplier(items: StockCheckItem[]) {
  const groups: Array<{ supplier: string; items: StockCheckItem[] }> = [];
  for (const item of items) {
    const supplier = item.supplierName ?? "No supplier";
    const last = groups[groups.length - 1];
    if (last && last.supplier === supplier) last.items.push(item);
    else groups.push({ supplier, items: [item] });
  }
  return groups;
}

/**
 * Staff stock-check form, shared by the personal-phone (`/clock`) and shared
 * kiosk (`/kiosk`) flows. The page passes the relevant server action (each
 * resolves the business from its own capability token) plus the active items.
 * PIN-authed, no location check. Items left on "Leave unchanged" aren't recorded.
 */
export function StockCheckForm({
  action,
  staffId,
  staffName,
  items,
  backHref,
}: {
  action: (
    prev: StockCheckResult,
    formData: FormData,
  ) => Promise<StockCheckResult>;
  staffId: string;
  staffName: string;
  items: StockCheckItem[];
  backHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, initial);

  if (state.status === "success") {
    return <KioskSuccess message={state.message} backHref={backHref} />;
  }

  const groups = groupBySupplier(items);

  return (
    <div className={`mt-2 ${kioskCls.card}`}>
      <h1 className={kioskCls.heading}>Stock check</h1>
      <p className={kioskCls.sub}>
        {staffName}, mark what&apos;s running low or needs ordering. Leave the
        rest unchanged.
      </p>

      {state.status === "error" ? (
        <div className="mt-4">
          <Banner tone="warn">{state.message}</Banner>
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className={`mt-4 ${kioskCls.muted}`}>
          No items to check yet. Your manager adds the items.
        </p>
      ) : (
        <form action={formAction} className="mt-5 space-y-5">
          <input type="hidden" name="staffId" value={staffId} />

          {groups.map((group) => (
            <fieldset key={group.supplier} className="space-y-3">
              <legend className="font-archivo text-[11px] font-bold uppercase tracking-[0.06em] text-[#9CA3AF]">
                {group.supplier}
              </legend>
              {group.items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[12px] border border-[#2A3344] p-3"
                >
                  <p className="font-semibold text-white">
                    {item.name}
                    {item.unit ? (
                      <span className="ml-1 font-normal text-[#9CA3AF]">
                        ({item.unit})
                      </span>
                    ) : null}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <label className="block flex-1">
                      <span className={kioskCls.smallLabel}>Status</span>
                      <select
                        name={`status_${item.id}`}
                        defaultValue=""
                        aria-label={`${item.name} status`}
                        className={kioskCls.input}
                      >
                        {STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block flex-1">
                      <span className={kioskCls.smallLabel}>
                        How much left? (optional)
                      </span>
                      <input
                        name={`qty_${item.id}`}
                        maxLength={40}
                        placeholder="e.g. 2 boxes"
                        className={kioskCls.input}
                        aria-label={`${item.name} quantity left`}
                      />
                    </label>
                  </div>
                </div>
              ))}
            </fieldset>
          ))}

          <label className="block">
            <span className={kioskCls.label}>Your PIN</span>
            <input
              name="pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              pattern="\d{4}"
              maxLength={4}
              required
              placeholder="••••"
              className={kioskCls.pin}
              aria-label="Your 4-digit PIN"
            />
          </label>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={pending}
              className={kioskCls.primary}
            >
              {pending ? "Saving…" : "Submit stock check"}
            </button>
            <Link href={backHref} className={kioskCls.cancel}>
              Cancel
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
