"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Banner, Button, ButtonLink, Card, PageHeader } from "@/components/ui";
import { SAMPLE_ITEMS_CSV, type ImportPreview } from "@/lib/item-import";
import {
  previewItemsImport,
  commitItemsImport,
  type CommitResult,
} from "./actions";

const STATUS_BADGE: Record<
  ImportPreview["rows"][number]["status"],
  { label: string; className: string }
> = {
  new: { label: "Will add", className: "bg-[var(--color-ok)] text-white" },
  duplicate: {
    label: "Skip (duplicate)",
    className: "bg-[var(--color-warn)] text-white",
  },
  error: {
    label: "Skip (error)",
    className: "bg-[var(--color-danger)] text-white",
  },
};

function supplierText(supplier: ImportPreview["rows"][number]["supplier"]) {
  if (supplier.kind === "matched") return `→ ${supplier.name}`;
  if (supplier.kind === "unmatched")
    return `“${supplier.name}” not found — left blank`;
  return "—";
}

export default function ItemsImportPage() {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onTextChange(value: string) {
    setText(value);
    // Any edit invalidates a stale preview/result.
    setPreview(null);
    setResult(null);
    setError(null);
  }

  function doPreview() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        setPreview(await previewItemsImport(text));
      } catch {
        setError("Couldn't read that CSV. Check the format and try again.");
      }
    });
  }

  function doCommit() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await commitItemsImport(text);
        setResult(res);
        setPreview(null);
        setText("");
      } catch {
        setError("Something went wrong importing. Nothing was saved.");
      }
    });
  }

  const counts = preview?.counts;

  return (
    <>
      <PageHeader
        title="Import items from CSV"
        subtitle="Paste your spreadsheet as CSV. You'll see a preview before anything is saved."
        action={
          <ButtonLink href="/app/items" variant="secondary">
            Back to items
          </ButtonLink>
        }
      />

      {result ? (
        <Banner tone="success">
          Imported {result.added} item{result.added === 1 ? "" : "s"}.{" "}
          {result.duplicates > 0
            ? `${result.duplicates} skipped as duplicates. `
            : ""}
          {result.errors > 0 ? `${result.errors} skipped with errors. ` : ""}
          <Link
            href="/app/items"
            className="font-semibold underline underline-offset-2"
          >
            View items
          </Link>
        </Banner>
      ) : null}
      {error ? <Banner tone="warn">{error}</Banner> : null}

      <Card className="mt-4">
        <h2 className="text-lg font-semibold">Expected format</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Columns: <strong>name</strong> (required), <strong>sku_code</strong>,{" "}
          <strong>unit</strong>, <strong>supplier_name</strong> (optional). A
          header row is detected automatically. Supplier names are matched to
          your existing suppliers (case-insensitive); unmatched names import the
          item with no supplier. Rows whose name already exists (by name or SKU)
          are skipped.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] p-3 text-xs">
          {SAMPLE_ITEMS_CSV}
        </pre>
        <a
          href="/app/items/sample"
          className="mt-2 inline-block text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
        >
          Download a sample template
        </a>
      </Card>

      <Card className="mt-4">
        <label htmlFor="csv" className="block text-lg font-semibold">
          Paste your CSV
        </label>
        <textarea
          id="csv"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          rows={10}
          placeholder={SAMPLE_ITEMS_CSV}
          className="mt-2 block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3 font-mono text-sm"
          aria-label="CSV text"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={doPreview}
            disabled={isPending || text.trim().length === 0}
          >
            {isPending && !preview ? "Reading…" : "Preview"}
          </Button>
        </div>
      </Card>

      {preview ? (
        <section className="mt-6" aria-label="Import preview">
          <h2 className="mb-2 text-lg font-semibold">Preview</h2>
          {counts && counts.total === 0 ? (
            <p className="text-[var(--color-muted)]">
              No rows found in that CSV.
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-[var(--color-muted)]">
                {counts!.toAdd} to add · {counts!.duplicates} duplicate
                {counts!.duplicates === 1 ? "" : "s"} · {counts!.errors} error
                {counts!.errors === 1 ? "" : "s"} · {counts!.suppliersMatched}{" "}
                supplier match
                {counts!.suppliersMatched === 1 ? "" : "es"}
                {counts!.suppliersUnmatched > 0
                  ? ` · ${counts!.suppliersUnmatched} supplier name${
                      counts!.suppliersUnmatched === 1 ? "" : "s"
                    } not found`
                  : ""}
                {preview.headerDetected ? " · header row ignored" : ""}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-line)] text-left">
                      <th className="py-2 pr-3">Line</th>
                      <th className="py-2 pr-3">Name</th>
                      <th className="py-2 pr-3">SKU</th>
                      <th className="py-2 pr-3">Unit</th>
                      <th className="py-2 pr-3">Supplier</th>
                      <th className="py-2 pr-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => {
                      const badge = STATUS_BADGE[r.status];
                      return (
                        <tr
                          key={r.lineNumber}
                          className="border-b border-[var(--color-line)] align-top"
                        >
                          <td className="py-2 pr-3 text-[var(--color-muted)]">
                            {r.lineNumber}
                          </td>
                          <td className="py-2 pr-3">
                            {r.name || (
                              <span className="text-[var(--color-muted)]">
                                (none)
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-3">{r.skuCode ?? "—"}</td>
                          <td className="py-2 pr-3">{r.unit ?? "—"}</td>
                          <td className="py-2 pr-3">
                            {supplierText(r.supplier)}
                          </td>
                          <td className="py-2 pr-3">
                            <span
                              className={`rounded px-2 py-0.5 text-xs font-semibold ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                            {r.message ? (
                              <span className="mt-1 block text-xs text-[var(--color-muted)]">
                                {r.message}
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  onClick={doCommit}
                  disabled={isPending || counts!.toAdd === 0}
                >
                  {isPending
                    ? "Importing…"
                    : `Import ${counts!.toAdd} item${
                        counts!.toAdd === 1 ? "" : "s"
                      }`}
                </Button>
                {counts!.toAdd === 0 ? (
                  <span className="text-sm text-[var(--color-muted)]">
                    Nothing to import — fix the rows above and preview again.
                  </span>
                ) : null}
              </div>
            </>
          )}
        </section>
      ) : null}
    </>
  );
}
