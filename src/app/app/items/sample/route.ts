import { requireOwner } from "@/lib/auth/context";
import { SAMPLE_ITEMS_CSV } from "@/lib/item-import";

/**
 * Downloadable sample items CSV template. Owner-only (so it sits behind the same
 * guard as the rest of /app), but it returns only the static sample — no tenant
 * data — so the owner can see the expected column format.
 */
export async function GET() {
  await requireOwner();
  return new Response(SAMPLE_ITEMS_CSV, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="items-template.csv"',
    },
  });
}
