import { NextResponse, type NextRequest } from "next/server";
import { ownerRepo } from "@/lib/auth/context";
import { DEFAULT_TIMEZONE, zonedDateTimeToUtc, isoWeekday } from "@/lib/time";
import { buildApprovedHoursCsv } from "@/lib/timesheet-export";

/** Add `n` whole days to a YYYY-MM-DD date (calendar math, tz-independent). */
function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d!));
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** The Monday (YYYY-MM-DD) of the week containing `dateStr`. */
function mondayOf(dateStr: string): string {
  return addDays(dateStr, -(isoWeekday(dateStr) - 1));
}

/**
 * Download approved hours for one week as CSV. Owner session only (via
 * ownerRepo), scoped to the owner's business. Only entries the owner has marked
 * approved are exported. This is hours + rates for import elsewhere, not a
 * payroll calculation (see the disclaimer embedded in the file).
 */
export async function GET(req: NextRequest) {
  const repo = await ownerRepo();
  const business = await repo.getBusiness();
  if (!business) {
    return new NextResponse("No business", { status: 404 });
  }
  const tz = business.timezone ?? DEFAULT_TIMEZONE;

  const weekParam = req.nextUrl.searchParams.get("week");
  // Default to the current week if none/invalid was supplied.
  const base =
    weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam)
      ? weekParam
      : new Intl.DateTimeFormat("en-CA", {
          timeZone: tz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date());
  const weekStart = mondayOf(base);
  const weekEnd = addDays(weekStart, 7);
  const startUtc = zonedDateTimeToUtc(weekStart, "00:00", tz);
  const endUtc = zonedDateTimeToUtc(weekEnd, "00:00", tz);

  const rows = await repo.listApprovedEntriesForExport(startUtc, endUtc);
  const csv = buildApprovedHoursCsv(rows, {
    timezone: tz,
    businessName: business.name,
  });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="approved-hours-${weekStart}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
