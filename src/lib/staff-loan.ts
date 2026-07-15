/**
 * Pure date logic for staff loans (M29 Phase 4). Loans use inclusive calendar
 * dates ("YYYY-MM-DD" strings, like shift/leave dates), which sort lexically, so
 * a plain string compare is a correct date compare — no timezone maths here (the
 * caller passes the business-local "today").
 */

export type LoanStatus = "upcoming" | "active" | "ended";

/**
 * Where a loan sits relative to `today`: before its start = `upcoming`, within
 * [start, end] inclusive = `active`, after its end = `ended`.
 */
export function loanStatus(
  startDate: string,
  endDate: string,
  today: string,
): LoanStatus {
  if (today < startDate) return "upcoming";
  if (today > endDate) return "ended";
  return "active";
}

/** Whether the loan is in force on `today` (its active window). */
export function isLoanActiveOn(
  startDate: string,
  endDate: string,
  today: string,
): boolean {
  return loanStatus(startDate, endDate, today) === "active";
}
