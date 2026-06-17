import { NextResponse } from "next/server";
import { ownerRepo } from "@/lib/auth/context";
import { getFormExport } from "@/lib/form-export";

/** UTF-8 byte-order mark — makes Excel detect UTF-8 and render accents. */
const BOM = String.fromCharCode(0xfeff);

/**
 * Download a form's responses as CSV. OWNER session only (via `ownerRepo`),
 * scoped to the owner's business — `getFormExport` resolves the form through
 * `getFormWithFields`, so a form that isn't this business's yields 404. NEVER
 * the public slug resolver. The filename is a slug of the (sanitised) title.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const repo = await ownerRepo();
  const result = await getFormExport(repo, id);
  if (!result.ok) {
    return new NextResponse("Not found", { status: 404 });
  }
  return new NextResponse(BOM + result.csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
