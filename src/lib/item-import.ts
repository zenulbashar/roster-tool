/**
 * Pure CSV import logic for inventory items (Part 1). No DB, no I/O — the owner
 * pastes CSV text, we parse + validate it here, and the caller (a server action)
 * loads suppliers / existing items and decides what to write. Everything is a
 * pure function so it can be hammered with messy input in tests.
 *
 * Forgiving by design: trims whitespace, skips blank lines, tolerates a header
 * row (detected and mapped, or assumed positional), handles quoted fields with
 * embedded commas/newlines/quotes (RFC 4180 style). A row missing the required
 * `name` is reported as an error, never silently dropped.
 *
 * This is the IMPORT (parse) direction; `timesheet-export.ts` is the matching
 * EXPORT (build) direction — same house style, opposite way round.
 */

/** Logical columns we understand in an items CSV. */
export type ItemColumn = "name" | "skuCode" | "unit" | "supplierName";

/** Default positional order when there's no header row. */
const POSITIONAL: ItemColumn[] = ["name", "skuCode", "unit", "supplierName"];

/** Header synonyms → logical column. Compared after normalising the header. */
const HEADER_SYNONYMS: Record<string, ItemColumn> = {
  name: "name",
  item: "name",
  itemname: "name",
  product: "name",
  sku: "skuCode",
  skucode: "skuCode",
  code: "skuCode",
  unit: "unit",
  uom: "unit",
  units: "unit",
  supplier: "supplierName",
  suppliername: "supplierName",
  vendor: "supplierName",
};

/** Normalise a header cell: lowercase, strip everything but a–z0–9. */
function normaliseHeader(cell: string): string {
  return cell.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Parse CSV text into rows of string cells. Single-pass RFC-4180-ish tokenizer:
 * - fields may be double-quoted; quotes inside a quoted field are doubled ("").
 * - quoted fields may contain commas and newlines.
 * - handles CRLF and LF line endings.
 * - unquoted cells are trimmed; quoted cells are kept verbatim (then the caller
 *   trims logical values).
 * - fully-blank lines (no cells, or a single empty cell) are skipped.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let quoted = false; // did the current field open with a quote?
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(quoted ? field : field.trim());
    field = "";
    quoted = false;
  };
  const endRow = () => {
    endField();
    // Skip blank lines (a single empty cell from an empty line).
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      quoted = true;
      i++;
      continue;
    }
    if (ch === ",") {
      endField();
      i++;
      continue;
    }
    if (ch === "\r") {
      // Swallow CRLF as a single line break.
      if (text[i + 1] === "\n") i++;
      endRow();
      i++;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Flush the final field/row if the text didn't end with a newline.
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/**
 * Decide whether the first row is a header and return the column order. A row is
 * treated as a header if at least one cell maps to a known synonym AND no cell
 * looks like plain data we can't place. We require a recognisable `name`-ish
 * column to accept a header; otherwise we assume positional columns.
 */
export function detectColumns(firstRow: string[]): {
  isHeader: boolean;
  columns: ItemColumn[];
} {
  const mapped = firstRow.map((c) => HEADER_SYNONYMS[normaliseHeader(c)]);
  const known = mapped.filter((m): m is ItemColumn => m !== undefined);
  const hasName = known.includes("name");
  // Only call it a header when we recognise a name column and at least one cell
  // resolved — a data row like "Milk,MLK,kg" won't (none are header words).
  if (hasName && known.length >= 1) {
    const columns = mapped.map((m, idx) => m ?? POSITIONAL[idx] ?? "name");
    return { isHeader: true, columns };
  }
  return { isHeader: false, columns: POSITIONAL };
}

/** How a row's supplier_name resolved against the business's suppliers. */
export type SupplierMatch =
  | { kind: "none" } // no supplier_name supplied
  | { kind: "matched"; supplierId: string; name: string }
  | { kind: "unmatched"; name: string }; // supplied but no match

/** Per-row outcome of validating + deduping a parsed CSV row. */
export type PreviewRow = {
  /** 1-based line number in the pasted text (counting the header if present). */
  lineNumber: number;
  name: string;
  skuCode: string | null;
  unit: string | null;
  supplier: SupplierMatch;
  status: "new" | "duplicate" | "error";
  message?: string;
};

export type ImportPreview = {
  headerDetected: boolean;
  rows: PreviewRow[];
  counts: {
    total: number;
    toAdd: number;
    duplicates: number;
    errors: number;
    suppliersMatched: number;
    suppliersUnmatched: number;
  };
};

/** The rows we'll actually insert (only `new` rows). */
export type ItemToInsert = {
  name: string;
  skuCode: string | null;
  unit: string | null;
  supplierId: string | null;
};

export type ExistingItemKey = { name: string; skuCode: string | null };
export type SupplierRef = { id: string; name: string };

const blankToNull = (v: string | undefined): string | null => {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
};

/**
 * Parse, validate, supplier-match and dedupe pasted CSV into a preview.
 *
 * Dedupe behaviour: a row is a `duplicate` (and skipped) when its name OR its
 * sku_code (both case-insensitive) already exists for the business, OR when it
 * repeats an earlier valid row in the same upload (first occurrence wins). A row
 * with no name is an `error`. Supplier names are matched case-insensitively;
 * unmatched names import the item with no supplier (flagged). Suppliers are
 * never created from a CSV.
 */
export function buildImportPreview(
  text: string,
  ctx: { suppliers: SupplierRef[]; existingItems: ExistingItemKey[] },
): ImportPreview {
  const parsed = parseCsvRows(text);
  if (parsed.length === 0) {
    return {
      headerDetected: false,
      rows: [],
      counts: {
        total: 0,
        toAdd: 0,
        duplicates: 0,
        errors: 0,
        suppliersMatched: 0,
        suppliersUnmatched: 0,
      },
    };
  }

  const { isHeader, columns } = detectColumns(parsed[0]!);
  const dataRows = isHeader ? parsed.slice(1) : parsed;
  const lineOffset = isHeader ? 2 : 1; // 1-based line of the first data row

  // Case-insensitive lookups.
  const supplierByName = new Map<string, SupplierRef>();
  for (const s of ctx.suppliers) supplierByName.set(s.name.toLowerCase(), s);
  const existingNames = new Set(
    ctx.existingItems.map((e) => e.name.toLowerCase()),
  );
  const existingSkus = new Set(
    ctx.existingItems
      .filter((e) => e.skuCode)
      .map((e) => e.skuCode!.toLowerCase()),
  );

  // Track keys seen within this upload so repeats become duplicates.
  const seenNames = new Set<string>();
  const seenSkus = new Set<string>();

  const rows: PreviewRow[] = [];
  let toAdd = 0;
  let duplicates = 0;
  let errors = 0;
  let suppliersMatched = 0;
  let suppliersUnmatched = 0;

  dataRows.forEach((cells, idx) => {
    const lineNumber = lineOffset + idx;
    const get = (col: ItemColumn): string | undefined => {
      const at = columns.indexOf(col);
      return at >= 0 ? cells[at] : undefined;
    };

    const name = (get("name") ?? "").trim();
    const skuCode = blankToNull(get("skuCode"));
    const unit = blankToNull(get("unit"));
    const supplierNameRaw = blankToNull(get("supplierName"));

    // Supplier matching (independent of row validity, so the preview is honest).
    let supplier: SupplierMatch;
    if (!supplierNameRaw) {
      supplier = { kind: "none" };
    } else {
      const found = supplierByName.get(supplierNameRaw.toLowerCase());
      if (found) {
        supplier = { kind: "matched", supplierId: found.id, name: found.name };
        suppliersMatched++;
      } else {
        supplier = { kind: "unmatched", name: supplierNameRaw };
        suppliersUnmatched++;
      }
    }

    if (name.length === 0) {
      errors++;
      rows.push({
        lineNumber,
        name: "",
        skuCode,
        unit,
        supplier,
        status: "error",
        message: "Missing item name — this row will be skipped.",
      });
      return;
    }

    const nameKey = name.toLowerCase();
    const skuKey = skuCode?.toLowerCase() ?? null;
    const dupByName = existingNames.has(nameKey) || seenNames.has(nameKey);
    const dupBySku =
      skuKey !== null && (existingSkus.has(skuKey) || seenSkus.has(skuKey));

    if (dupByName || dupBySku) {
      duplicates++;
      const why = dupByName
        ? `An item named “${name}” already exists.`
        : `SKU code “${skuCode}” already exists.`;
      rows.push({
        lineNumber,
        name,
        skuCode,
        unit,
        supplier,
        status: "duplicate",
        message: `${why} This row will be skipped.`,
      });
      return;
    }

    seenNames.add(nameKey);
    if (skuKey !== null) seenSkus.add(skuKey);
    toAdd++;
    rows.push({
      lineNumber,
      name,
      skuCode,
      unit,
      supplier,
      status: "new",
    });
  });

  return {
    headerDetected: isHeader,
    rows,
    counts: {
      total: rows.length,
      toAdd,
      duplicates,
      errors,
      suppliersMatched,
      suppliersUnmatched,
    },
  };
}

/** The insertable rows from a preview (the `new` ones), for the commit step. */
export function itemsToInsert(preview: ImportPreview): ItemToInsert[] {
  return preview.rows
    .filter((r) => r.status === "new")
    .map((r) => ({
      name: r.name,
      skuCode: r.skuCode,
      unit: r.unit,
      supplierId: r.supplier.kind === "matched" ? r.supplier.supplierId : null,
    }));
}

/** A small sample CSV (with header) shown/downloaded to guide owners. */
export const SAMPLE_ITEMS_CSV = `name,sku_code,unit,supplier_name
Full cream milk 2L,MILK-2L,each,Dairy Co
Coffee beans 1kg,BEAN-1KG,kg,Bean Bros
Takeaway cups 12oz,CUP-12,box,
`;
