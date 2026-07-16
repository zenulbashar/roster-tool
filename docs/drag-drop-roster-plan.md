# Drag-and-drop roster builder (M30) — plan & decisions

The owner asked for: build/rearrange the roster by **dragging employees
across the calendar** (day → day, person → person), **colour-code each
employee** so their worked span reads as a colour block across the day,
**resize a shift's length** per person (e.g. Ava works 9 am – 9 pm on a
9 am – 5 pm block), and **drop a 30 min / 1 hour break** into a shift —
especially right after "Draft from last week", so tweaking the draft is a
matter of dragging chips around.

Status: **built** (all phases). This doc records the research, the model
decision, and the invariants that must hold as it evolves.

## What the builder was

`/app/periods/[id]/build` was a server component: a read-only staff × day
matrix on top and a tap-a-name chip editor below, all server actions, no
client interactivity. Colours were per **shift type** (`shift_template.color`
via `resolveShiftColors`), though `avatarColor(staffId)` already gave every
person a stable AA-contrast colour.

## The model decision (the crux)

A `shift` is a concrete block (`date`, `startTime`, `endTime`) whose times are
shared by everyone on it; a `roster_assignment` was just (shift, staff,
status) — no per-person times, no break. Two of the four asks (resize,
breaks) therefore needed **per-assignment schedule data**. Decision (owner
chose the full build):

- `roster_assignment` gains **nullable `start_time` / `end_time`** (an
  override: "this person works different hours on this block"),
  **`break_minutes`** (NOT NULL default 0; allowed 0/30/60, mirroring the
  timesheet break options) and **`break_start`** (nullable; where the break
  sits, so the gap can be drawn and dragged). Additive migration `0028`.
- **Null override = the shift's own times** — every pre-existing row renders
  and publishes exactly as before; nothing is backfilled.
- **The shift block stays the slot's source of truth.** Availability stays
  per-shift (yes/no to the block), draft-from-last-week matches blocks, and
  the shift's snapshot times keep powering the open-shifts row, swaps and
  kiosk lists. The override is a per-person refinement on top, shown wherever
  that person's hours are shown.
- **Roster breaks are display/plan only.** Worked hours, the CSV export, the
  labour report and the Xero push all still come from `timesheet_entry` (its
  own `break_minutes`) — a rostered break is a plan, not a payroll input.

## Architecture

Pure maths (no I/O) in `src/lib/assignment-schedule.ts`, hammered by
`tests/assignment-schedule.test.ts`:

- `resolveSchedule(shift, assignment)` → the person's effective times +
  break (`overridden` flag); `scheduleSegments` → the 1–2 worked segments the
  bars draw (break = gap); `workedMinutes` (net of break, clamped ≥ 0).
- `validateSchedule` — same-day times (the app has no overnight shifts;
  template validation enforces start < end), ≥ 15 min span, break ∈ {0,30,60}
  and fully inside the span. Run client-side for live feedback AND re-run in
  the server action.
- `carrySchedule` — what a move keeps: the override + break travel only when
  the target block runs the **same base times** (same type on another day);
  otherwise the times reset to the target's and the break survives only if it
  still fits. Stale times must never silently misstate someone's hours.
- `findMatchingShiftOnDate` — drop-target resolution: same `templateId`
  first (survives renames), else label + times (survives template deletion).

Repository (`createTenantRepo`):

- `listAssignments` / `rosterRows` expose the override columns.
- `moveAssignment` — ONE transaction: source row locked (`FOR UPDATE`),
  both shifts verified same business AND same period, schedule carried via
  `carrySchedule`, merge on conflict (a confirmed source never downgrades a
  row to suggested). Tenant-scoped like everything else.
- `setAssignmentSchedule` — set/clear the override; null times + break =
  break-only assignment. Covered by `tests/assignment-schedule-flow.test.ts`.

UI (`src/components/RosterBoard.tsx`, a client island; @dnd-kit/core):

- The weekly grid becomes draggable: chips (confirmed assignments) drag to
  any (staff, day) cell, onto a specific open block, or to the Open-shifts
  row (= unassign; the vacated block shows as open — a drag never deletes a
  shift, so a slot is never silently lost). Open blocks drag onto people.
- Drop resolution is **re-derived server-side**; the client only points.
  Same-day drop on another person = the same shift changes hands; another
  day = that day's matching block, **cloned onto the day when none exists**
  (label/times/template copied) so "move Ava to Wednesday" always works.
- **Colour-by-employee is the default** (toggle to by-type): chip wash +
  proportional 24 h day bar in the person's stable `avatarColor`, break gap
  visible in the bar. Legend adapts.
- Click a chip → **schedule editor** (modal): a 24 h timeline with draggable
  start/end handles and a draggable break block, mirrored by ±15 min stepper
  buttons and None/30 min/1 hour break choices (so keyboard/touch work), live
  validation + "Working 7h 30m" summary, Reset to shift times, Remove from
  shift. Saving times equal to the block's own collapses back to "no
  override" (no misleading Custom badge).
- Optimistic updates via `useOptimistic` + `router.refresh()`; failures
  toast and the refresh reverts the paint. Suggested chips keep explicit
  Accept/✕ (drag is for confirmed chips). While dragging, the hovered cell
  hints availability (green/amber ring from the target block's responses)
  and "New shift" when the drop would clone.
- The tap-a-name editor below the board is unchanged — the fully
  keyboard-accessible path to every same-shift assign/unassign.

Server actions (in the build page, all zod-validated →
`assignmentMoveSchema` / `openShiftAssignSchema` / `assignmentPairSchema` /
`assignmentScheduleSchema`, all re-deriving ids through the tenant repo and
re-running `validateSchedule`): move, assign-open, unassign, set-schedule,
accept/clear suggestion. Every one checks the shift belongs to THIS period
and the date sits inside it.

Ripples (per-person hours must show wherever hours show):

- `rosterRows` carries the override → the public roster (`/r`) shows
  "Ava (10 am – 3 pm, 30 min break)" beside a name that differs from the
  block, and the published-roster email uses each person's effective times
  with the unpaid break spelled out (`handlePublishedRoster`, covered in
  `tests/availability-flow.test.ts`).

## Invariants

1. Null override ⇔ the shift's own times; an override always has BOTH times.
2. `break_minutes` > 0 ⇔ `break_start` set; the break fits inside the
   effective times (validateSchedule, enforced in the action).
3. A move never crosses roster periods or businesses, and never deletes a
   shift — vacated blocks surface in the Open row.
4. Overrides never move onto a block with different base times
   (`carrySchedule`) — they reset rather than lie.
5. Only confirmed assignments publish; suggested chips can't drag.
6. Roster breaks/overrides never feed timesheets, the CSV export, the labour
   report or Xero — those read `timesheet_entry` only.

## Deliberately not built (flag before adding)

- **Overnight per-person times** — the app has no overnight shifts anywhere;
  keep the single-day axis until shifts themselves support it.
- **Carrying overrides across weeks** in "Draft from last week" — drafts
  suggest people, not custom hours; a stale override on a new week is a
  surprise, not a convenience.
- **Multiple breaks per shift**, custom break lengths beyond 0/30/60.
- **Drag on the kiosk/staff surfaces** — the board is owner-only.
- **Auto-deleting a shift emptied by a drag** — owners delete via period
  rebuild; silent deletion loses slots.
