import { describe, it, expect } from "vitest";
import {
  parseCsvRows,
  detectColumns,
  buildImportPreview,
  itemsToInsert,
  type SupplierRef,
  type ExistingItemKey,
} from "@/lib/item-import";

/**
 * The CSV importer is the highest-risk part of the inventory feature, so this
 * hammers the pure parser/validator with messy input: quoting, embedded commas
 * and newlines, headers (present / absent / weird), blank lines, missing
 * required fields, supplier matching and dedupe (against existing rows AND
 * within the same upload).
 */

describe("parseCsvRows", () => {
  it("parses simple rows and trims unquoted cells", () => {
    expect(parseCsvRows("a,b,c\n d , e ,f")).toEqual([
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
  });

  it("handles quoted fields with embedded commas", () => {
    expect(parseCsvRows('"Smith, John",MLK,kg')).toEqual([
      ["Smith, John", "MLK", "kg"],
    ]);
  });

  it("keeps quoted whitespace verbatim", () => {
    expect(parseCsvRows('"  spaced  ",x')).toEqual([["  spaced  ", "x"]]);
  });

  it("handles doubled quotes as a literal quote", () => {
    expect(parseCsvRows('"a ""quoted"" word",b')).toEqual([
      ['a "quoted" word', "b"],
    ]);
  });

  it("handles newlines inside quoted fields", () => {
    expect(parseCsvRows('"line one\nline two",b')).toEqual([
      ["line one\nline two", "b"],
    ]);
  });

  it("treats CRLF and LF the same and skips blank lines", () => {
    expect(parseCsvRows("a,b\r\n\r\nc,d\n\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("flushes a final row with no trailing newline", () => {
    expect(parseCsvRows("a,b")).toEqual([["a", "b"]]);
  });

  it("returns no rows for empty / whitespace-only text", () => {
    expect(parseCsvRows("")).toEqual([]);
    // A line of only spaces trims to an empty cell and is skipped as blank.
    expect(parseCsvRows("\n\n  \n")).toEqual([]);
  });
});

describe("detectColumns", () => {
  it("detects a standard header and maps synonyms", () => {
    const { isHeader, columns } = detectColumns([
      "Name",
      "SKU Code",
      "Unit",
      "Supplier",
    ]);
    expect(isHeader).toBe(true);
    expect(columns).toEqual(["name", "skuCode", "unit", "supplierName"]);
  });

  it("maps alternative header words (item/code/uom/vendor)", () => {
    const { isHeader, columns } = detectColumns([
      "Item",
      "Code",
      "UOM",
      "Vendor",
    ]);
    expect(isHeader).toBe(true);
    expect(columns).toEqual(["name", "skuCode", "unit", "supplierName"]);
  });

  it("assumes positional columns when there's no recognisable header", () => {
    const { isHeader, columns } = detectColumns(["Milk", "MLK", "kg"]);
    expect(isHeader).toBe(false);
    expect(columns).toEqual(["name", "skuCode", "unit", "supplierName"]);
  });

  it("handles a header with only some known columns", () => {
    const { isHeader, columns } = detectColumns(["name", "mystery"]);
    expect(isHeader).toBe(true);
    expect(columns[0]).toBe("name");
  });
});

const suppliers: SupplierRef[] = [
  { id: "sup-dairy", name: "Dairy Co" },
  { id: "sup-bean", name: "Bean Bros" },
];

describe("buildImportPreview", () => {
  it("imports clean rows with a header, matching suppliers case-insensitively", () => {
    const csv = [
      "name,sku_code,unit,supplier_name",
      "Milk 2L,MLK-2L,each,dairy co",
      "Beans 1kg,BN-1,kg,BEAN BROS",
    ].join("\n");
    const preview = buildImportPreview(csv, { suppliers, existingItems: [] });
    expect(preview.headerDetected).toBe(true);
    expect(preview.counts.toAdd).toBe(2);
    expect(preview.counts.suppliersMatched).toBe(2);
    expect(preview.rows[0]!.supplier).toMatchObject({
      kind: "matched",
      supplierId: "sup-dairy",
    });
    expect(itemsToInsert(preview)).toEqual([
      {
        name: "Milk 2L",
        skuCode: "MLK-2L",
        unit: "each",
        supplierId: "sup-dairy",
      },
      { name: "Beans 1kg", skuCode: "BN-1", unit: "kg", supplierId: "sup-bean" },
    ]);
  });

  it("works without a header (positional columns)", () => {
    const preview = buildImportPreview("Milk,MLK,each", {
      suppliers,
      existingItems: [],
    });
    expect(preview.headerDetected).toBe(false);
    expect(preview.counts.toAdd).toBe(1);
    expect(preview.rows[0]!.lineNumber).toBe(1);
    expect(preview.rows[0]!.name).toBe("Milk");
  });

  it("flags an unmatched supplier but still imports the item with none", () => {
    const preview = buildImportPreview("Sugar,SUG,kg,Unknown Pty", {
      suppliers,
      existingItems: [],
    });
    expect(preview.counts.suppliersUnmatched).toBe(1);
    expect(preview.rows[0]!.supplier).toEqual({
      kind: "unmatched",
      name: "Unknown Pty",
    });
    expect(itemsToInsert(preview)[0]!.supplierId).toBeNull();
  });

  it("treats a missing name as an error (reported, not dropped)", () => {
    const csv = ["name,sku_code", "Milk,MLK", ",NOSKU"].join("\n");
    const preview = buildImportPreview(csv, { suppliers, existingItems: [] });
    expect(preview.counts.errors).toBe(1);
    expect(preview.counts.toAdd).toBe(1);
    const errorRow = preview.rows.find((r) => r.status === "error");
    expect(errorRow?.lineNumber).toBe(3);
    expect(errorRow?.message).toMatch(/missing item name/i);
  });

  it("dedupes against existing items by name (case-insensitive)", () => {
    const existingItems: ExistingItemKey[] = [
      { name: "Milk 2L", skuCode: null },
    ];
    const preview = buildImportPreview("milk 2l,NEW-SKU,each", {
      suppliers,
      existingItems,
    });
    expect(preview.counts.duplicates).toBe(1);
    expect(preview.counts.toAdd).toBe(0);
    expect(preview.rows[0]!.message).toMatch(/already exists/i);
  });

  it("dedupes against existing items by sku_code (case-insensitive)", () => {
    const existingItems: ExistingItemKey[] = [
      { name: "Something else", skuCode: "MLK-2L" },
    ];
    const preview = buildImportPreview("Milk,mlk-2l,each", {
      suppliers,
      existingItems,
    });
    expect(preview.counts.duplicates).toBe(1);
    expect(preview.rows[0]!.message).toMatch(/sku code/i);
  });

  it("dedupes repeats within the same upload (first wins)", () => {
    const csv = ["Milk,MLK,each", "MILK,OTHER,box", "Bread,BRD,each"].join(
      "\n",
    );
    const preview = buildImportPreview(csv, { suppliers, existingItems: [] });
    expect(preview.counts.toAdd).toBe(2);
    expect(preview.counts.duplicates).toBe(1);
    expect(preview.rows[1]!.status).toBe("duplicate");
  });

  it("skips blank lines and trims values, computing honest counts", () => {
    const csv = [
      "name,sku_code,unit,supplier_name",
      "  Milk 2L  ,  MLK  ,  each  ,  Dairy Co  ",
      "",
      "   ",
      "Beans,,,",
    ].join("\n");
    const preview = buildImportPreview(csv, { suppliers, existingItems: [] });
    expect(preview.counts.total).toBe(2);
    expect(preview.counts.toAdd).toBe(2);
    const [milk, beans] = preview.rows;
    expect(milk!.name).toBe("Milk 2L");
    expect(milk!.skuCode).toBe("MLK");
    expect(milk!.supplier).toMatchObject({ kind: "matched" });
    expect(beans!.skuCode).toBeNull();
    expect(beans!.unit).toBeNull();
    expect(beans!.supplier).toEqual({ kind: "none" });
  });

  it("handles quoted commas/newlines in item names end-to-end", () => {
    const csv = 'name,sku_code\n"Cups, 12oz, sleeve",CUP-12';
    const preview = buildImportPreview(csv, { suppliers, existingItems: [] });
    expect(preview.rows[0]!.name).toBe("Cups, 12oz, sleeve");
    expect(preview.counts.toAdd).toBe(1);
  });

  it("returns an empty preview for empty input", () => {
    const preview = buildImportPreview("   \n  ", {
      suppliers,
      existingItems: [],
    });
    expect(preview.counts.total).toBe(0);
    expect(preview.rows).toEqual([]);
  });
});
