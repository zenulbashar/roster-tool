"use server";

import { revalidatePath } from "next/cache";
import { ownerRepo } from "@/lib/auth/context";
import {
  buildImportPreview,
  itemsToInsert,
  type ImportPreview,
} from "@/lib/item-import";

/**
 * Server actions backing the two-step CSV import. Both take only the RAW pasted
 * text — never client-computed rows — and re-parse it server-side under the
 * owner's tenant scope. Preview shows what would happen; commit re-validates
 * from scratch and writes only the valid (`new`) rows. Nothing is persisted
 * between the steps.
 */

/** Parse + validate pasted CSV against this business's suppliers + items. */
export async function previewItemsImport(text: string): Promise<ImportPreview> {
  const repo = await ownerRepo();
  const [suppliers, existingItems] = await Promise.all([
    repo.listSuppliersForMatch(),
    repo.listItemKeysForDedupe(),
  ]);
  return buildImportPreview(text, { suppliers, existingItems });
}

export type CommitResult = {
  added: number;
  duplicates: number;
  errors: number;
};

/**
 * Re-parse the same text server-side and insert the valid rows. Re-loading
 * suppliers/items here (not trusting the preview the client holds) keeps the
 * write correct even if the data changed since preview.
 */
export async function commitItemsImport(text: string): Promise<CommitResult> {
  const repo = await ownerRepo();
  const [suppliers, existingItems] = await Promise.all([
    repo.listSuppliersForMatch(),
    repo.listItemKeysForDedupe(),
  ]);
  const preview = buildImportPreview(text, { suppliers, existingItems });
  const toInsert = itemsToInsert(preview);
  const inserted = await repo.bulkInsertItems(toInsert);
  revalidatePath("/app/items");
  return {
    added: inserted.length,
    duplicates: preview.counts.duplicates,
    errors: preview.counts.errors,
  };
}
