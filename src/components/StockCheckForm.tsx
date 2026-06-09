"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { StockCheckResult } from "@/lib/stock-check-submission";
import { Banner, Button, Card } from "@/components/ui";

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
    return (
      <Card className="mt-8 text-center">
        <p className="text-xl font-bold">{state.message}</p>
        <Link
          href={backHref}
          className="mt-6 inline-flex min-h-12 items-center justify-center rounded-lg bg-[var(--color-brand)] px-6 py-3 text-base font-semibold text-[var(--color-brand-ink)]"
        >
          Done
        </Link>
      </Card>
    );
  }

  const groups = groupBySupplier(items);

  return (
    <Card className="mt-6">
      <h1 className="text-2xl font-bold">Stock check</h1>
      <p className="mt-1 text-[var(--color-muted)]">
        {staffName}, mark what&apos;s running low or needs ordering. Leave the
        rest unchanged.
      </p>

      {state.status === "error" ? (
        <div className="mt-4">
          <Banner tone="warn">{state.message}</Banner>
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="mt-4 text-[var(--color-muted)]">
          No items to check yet. Your manager adds the items.
        </p>
      ) : (
        <form action={formAction} className="mt-4 space-y-5">
          <input type="hidden" name="staffId" value={staffId} />

          {groups.map((group) => (
            <fieldset key={group.supplier} className="space-y-3">
              <legend className="text-sm font-semibold text-[var(--color-muted)]">
                {group.supplier}
              </legend>
              {group.items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-[var(--color-line)] p-3"
                >
                  <p className="font-semibold">
                    {item.name}
                    {item.unit ? (
                      <span className="ml-1 font-normal text-[var(--color-muted)]">
                        ({item.unit})
                      </span>
                    ) : null}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <label className="block flex-1">
                      <span className="mb-1 block text-xs font-semibold">
                        Status
                      </span>
                      <select
                        name={`status_${item.id}`}
                        defaultValue=""
                        aria-label={`${item.name} status`}
                        className="block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-base"
                      >
                        {STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block flex-1">
                      <span className="mb-1 block text-xs font-semibold">
                        How much left? (optional)
                      </span>
                      <input
                        name={`qty_${item.id}`}
                        maxLength={40}
                        placeholder="e.g. 2 boxes"
                        className="block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-base"
                        aria-label={`${item.name} quantity left`}
                      />
                    </label>
                  </div>
                </div>
              ))}
            </fieldset>
          ))}

          <label className="block">
            <span className="mb-1 block text-sm font-semibold">Your PIN</span>
            <input
              name="pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              pattern="\d{4}"
              maxLength={4}
              required
              placeholder="••••"
              className="block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-center text-2xl tracking-[0.5em]"
              aria-label="Your 4-digit PIN"
            />
          </label>
          <div className="flex gap-3">
            <Button type="submit" disabled={pending} className="flex-1">
              {pending ? "Saving…" : "Submit stock check"}
            </Button>
            <Link
              href={backHref}
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-3 text-base font-semibold"
            >
              Cancel
            </Link>
          </div>
        </form>
      )}
    </Card>
  );
}
