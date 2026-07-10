# Pay classification rules — plan of record

**Status: approved to build** (research + plan reviewed; build authorized on the
same session). Extends M27 (Xero Payroll AU, `docs/xero-payroll-integration-plan.md`)
additively — same 2.0 client, same push path, same hard boundary.

## 0. What this is (and is not)

An **owner-configured** pay-classification rules engine. The owner authors
purely mechanical rules that map worked hours to **their own Xero pay items**
(earnings rates). When pushing a draft timesheet, Roster splits each shift's
hours into multiple Payroll 2.0 timesheet lines, each tagged with the owner's
chosen `earningsRateID`. **Xero's pay-item setup calculates every dollar.**

**HARD BOUNDARY (verbatim from the brief):**

- Roster ships with **ZERO built-in award rules, ZERO default penalty
  percentages, ZERO award names** in code/config/UI. The rules table ships
  **EMPTY**.
- A rule is purely a mechanical mapping the owner authors: a condition
  (day-of-week, hours-in-shift beyond N, time-of-day after X) → one of the
  owner's OWN Xero pay items.
- Roster stores **NO dollar figure and NO multiplier** — only the pay-item
  reference. All pay math lives in Xero.
- UI copy never implies Roster knows or applies awards.
- Evaluation is **deterministic, server-side, from stored clock data** — never
  client-supplied classifications.
- Overlapping rules resolve by **explicit owner-visible precedence** (an
  ordered list; first match wins) — never a silent pick.
- The pre-push preview shows the **full per-shift breakdown** — the human
  checkpoint on classification. Everything still lands as a **DRAFT** timesheet
  a human approves in Xero. M27's client boundary (no pay-run / approve /
  revert / employee-write methods) is untouched.

## 1. Verified foundations (all confirmed on main @ 51f5a00)

1. **Schema is sufficient.** `timesheet_entry.clock_in_at/clock_out_at`
   (timestamptz) + the business timezone support every condition type. Only ONE
   new table is needed (`pay_rule`); no timesheet changes.
2. **The 2.0 wire format is already per-line.** `createDraftTimesheet` emits
   `earningsRateID` on every `timesheetLines[]` element — today all lines carry
   the single input rate. Making it vary per line is a type + one-line builder
   change. The delete-then-create invariant, per-attempt idempotency key and
   payload-hash change detection are line-content-agnostic.
3. **All org pay items are available.** `listEarningsRates` (GET /PayItems)
   returns every earnings rate with id/name/type — rules can map to any of them.
4. **No gate moves.** Approved-only entries, Draft-only writes, owner preview,
   the pinned client method set — all unchanged.

## 2. Data model — `pay_rule` (migration 0021, additive)

Business-scoped; **ships empty** (no seed, no defaults). Columns:

- `id`, `business_id` (cascade), `name` (owner's label), `priority` (integer —
  the explicit precedence; lower evaluates first), `is_active` (default true),
- `condition_type` enum `pay_rule_condition_type`:
  `day_of_week | time_of_day_after | time_of_day_before | daily_hours_beyond |
  weekly_hours_beyond`,
- `condition_config` jsonb (zod-validated per type; stored WITHOUT the type —
  the enum column carries it):
  - `day_of_week` → `{ days: number[] }` (ISO 1–7, matching
    `shift_template.weekdays`)
  - `time_of_day_after` / `time_of_day_before` → `{ time: "HH:MM" }` (business-
    local wall clock)
  - `daily_hours_beyond` → `{ hours: number }` (0 < h ≤ 24)
  - `weekly_hours_beyond` → `{ hours: number }` (0 < h ≤ 168)
- `earnings_rate_id` (the owner's chosen Xero pay item — a REFERENCE only) +
  `earnings_rate_name` (display snapshot, refreshed on edit),
- `created_at` / `updated_at`.

**Deliberately absent:** any rate, multiplier, percentage, or dollar column.
Indexes on `(business_id)` and `(business_id, priority)`.

## 3. The classifier (`src/lib/xero/pay-rules.ts`, pure)

`classifyEntries({ entries, rules, ordinaryEarningsRateId, timezone,
periodStart, periodEnd })` → `{ lines, totalHours, skippedOpen, breakdown }`.

Semantics (mechanical, documented in UI copy):

- **Bucketing is unchanged from M27**: a shift's hours land on the line for the
  business-local date it STARTED (matching the CSV export and report), even
  when it runs past midnight.
- **Conditions look at each worked MOMENT's own local wall clock**: a Friday
  20:00 → Saturday 02:00 shift has 2 hours matching a Saturday `day_of_week`
  rule and, for `time_of_day_after 22:00`, matches only 22:00–24:00 (the clock
  reads 00:00–02:00 after midnight — an owner who wants late-night coverage
  adds a `time_of_day_before` rule to the same pay item).
- **Cumulative conditions**: `daily_hours_beyond` accumulates over the shift's
  bucket date; `weekly_hours_beyond` over the business-local **Monday-start
  week** of the bucket date. Entries are walked chronologically; the fetch
  window is widened back to the Monday of the week containing `periodStart` so
  a mid-week period start can't reset the weekly count (context entries add to
  cumulation but never produce lines).
- **Partitioning**: each entry is split into atomic sub-blocks at breakpoints —
  local midnights, each time-of-day rule's cutoff instant, and each
  daily/weekly threshold-crossing instant. Every sub-block is then matched
  against the ACTIVE rules in priority order; **first match wins**; no match →
  the employee's ordinary rate (from `xero_employee_map`).
- **Rounding reconciliation**: per bucket date the canonical total is computed
  exactly as M27 does (per-entry 2dp `hoursWorked`, summed, 2dp). Split lines
  are rounded to 2dp and the remainder (±0.01-scale) is absorbed into the
  largest line, so **the split lines always sum to the same day total the CSV/
  report/M27 push produce**. With zero rules the output is IDENTICAL to
  `buildTimesheetLines` (backward compatible by construction).
- `breakdown` is the per-shift segment list (start/end instants, hours, winning
  rule or ordinary) that feeds the pre-push preview.

## 4. Threading into the shipped push (additive)

- `XeroDraftTimesheetInput.lines[*]` gains optional `earningsRateId`; the ONE
  payload builder becomes `earningsRateID: l.earningsRateId ??
  input.earningsRateId`. **No client method added or removed** — the guard test
  key-set is untouched.
- `pushEmployeeTimesheet` gains `rules: ActivePayRule[]` (default `[]`) and
  calls `classifyEntries` instead of `buildTimesheetLines`; every line carries
  an explicit rate id. `hashPushPayload` now hashes `[date, earningsRateId,
  numberOfUnits]` per line, so **changing a rule re-pushes via the existing
  delete-then-create path** (one-time hash churn for existing drafts: first
  re-push after deploy recreates an identical draft — harmless, still Draft).
- The push action + preview page fetch entries from the Monday-of-week of
  `periodStart` (weekly cumulation context) and **validate active rules against
  the org's live pay items** — a rule pointing at a deleted pay item blocks the
  push with a named, owner-fixable error (never a silent skip or a Xero 400).

## 5. Owner UI (design system: Roster green #76b900, Archivo/Public Sans, ui.tsx kit)

- **`/app/xero/rules`** — the rules list, ordered by priority: condition
  description ("Hours on Saturday", "Hours after 10:00 PM", "Hours beyond 8 in
  a day"), the mapped pay item, active toggle, move up/down (the visible
  precedence), edit, delete. Add/edit form: name, condition type + config, pay
  item picked from the org's live `listEarningsRates`. Copy is award-free and
  states plainly: rules are the owner's own mappings; Roster stores no rates
  and calculates no pay; when several rules match the same hours the one
  highest in the list applies. Empty state: without rules every hour pushes
  under the employee's ordinary pay item (exactly M27 behaviour).
- **`/app/xero/push`** — per-employee expandable **per-shift breakdown** (each
  shift's segments → which rule → which pay item → hours) plus the per-day
  lines that will be sent. The single-rate note becomes: hours push under each
  employee's ordinary pay item except where YOUR rules map them to another of
  YOUR pay items; Roster never calculates rates or finalises pay.
- Links: mapping page + push page ↔ rules page.

## 6. Decisions locked at plan review

1. **Weekly cumulation** spans the full business-local Monday-start week
   (fetch-window widening), not just the pay period.
2. **Precedence** is a single owner-ordered list, first-match-wins per
   sub-block — visible and reorderable; never silent.
3. **Rounding remainder** is absorbed into the largest line of the day so split
   lines reconcile exactly with the M27/CSV/report day total.
4. **Rules are business-wide** (apply to every mapped employee); per-employee
   rules are a possible later phase, not built.

## 7. Boundary guards (tested)

- `pay_rule` has NO rate/multiplier/percent/dollar column (column-set test).
- Migration 0021 contains no `INSERT` (ships empty).
- No award/penalty-rate vocabulary in the rules engine or its UI copy
  (forbidden-terms test over the new sources).
- The Xero client's method set is byte-identical to M27's pinned guard test.
