# Drag-and-drop roster builder — research & plan

Status: **BUILT (M31 — both phases, owner chose "Full timeline").** Branch:
`claude/roster-drag-drop-calendar-x7r948`. What shipped vs this plan: Phase 1
as specced (drag-to-rearrange via `RosterBoard` + @dnd-kit, colour-by-employee
with an Employee/Type toggle, `chooseTargetShift` drop resolution, atomic
`moveAssignment`, tap editor kept as the accessible fallback); Phase 2 as a
**per-assignment schedule editor** (nullable
`roster_assignment.start_time`/`end_time`/`break_minutes`, migration `0028`)
opened by tapping a chip — drag handles + steppers rather than a full week
time-axis, with the proportional span bar on each chip giving the
length-of-time visual. §4.2 ripple decisions taken: availability stays
per-shift; public roster + publish emails show resolved per-person times;
draft-from-last-week copies the shaped schedule; CSV/report/Xero remain
timesheet-only.

Owner ask (paraphrased): while building a roster, let the owner drag an employee
from one day to another, resize a shift's length, and drop a 30/60-min break
into a shift. Every employee should be colour-coded so their worked time reads as
a coloured block on the calendar. The headline goal: after **"Draft from last
week"**, make the roster easy to adjust by **dragging employees around the
calendar** instead of tapping name-chips.

This doc records what the current builder actually is, the one architectural
decision that gates everything, and a **phased plan** so the high-value, in-scope
part ships first without committing the app to a model change it may not want.

---

## 1. What exists today (grounded in the code)

- **Builder page**: `src/app/app/periods/[id]/build/page.tsx` — a **server
  component**. It renders two things:
  1. a read-only **staff × day matrix** (the design's "hero grid"): rows =
     active staff, columns = each date in the period, each cell shows the shift
     chips that staff member holds that day, plus an **"Open shifts"** footer row
     of unassigned shifts.
  2. an interactive **"Assign staff"** editor below the grid: per shift, a row of
     name-chips you **tap** to assign/unassign. All mutations are **server
     actions** (`toggleAssign`, `acceptSuggestion`, `clearSuggestion`,
     `draftFromLastWeek`, `publish`) → `revalidatePath`. **No client-side
     interactivity, no drag today.**
- **Data model** (`src/lib/db/schema.ts`):
  - `shift_template` — reusable definition (`label`, `startTime`, `endTime`,
    `weekdays`, optional `color`, optional `dayTimeOverrides`).
  - `shift` — a **concrete block** for one `date` in a `roster_period`
    (`label`/`startTime`/`endTime` snapshotted, `templateId` nullable). **Times
    live on the shift and are SHARED by everyone assigned to it.**
  - `roster_assignment` — `(shiftId, staffMemberId, status: suggested|confirmed)`,
    unique per pair. Many staff per shift; a staff member on many shifts.
    **No per-assignment time and no break field.**
  - Breaks exist **only** on `timesheet_entry.break_minutes` (actual clocked
    hours), never on rostered shifts/assignments.
- **Repo primitives** (`src/lib/tenant/repository.ts`): `assign` (upsert →
  confirmed), `unassign` (delete), `createSuggestedAssignments`,
  `acceptSuggestion`, `clearSuggestion`, `createShifts`, `getShift`,
  `listShifts`. Everything is `businessId`-scoped.
- **Colours today are per shift-TYPE**, not per employee: `shift_template.color`
  → `resolveShiftColors(color, label)` (`src/lib/shift-colors.ts`). **But**
  `avatarColor(member.id)` (`src/lib/avatar.ts`) already returns a **stable,
  AA-contrast, per-employee colour** — reusing it makes "colour by employee"
  nearly free.
- **No drag-and-drop library** is installed (React 19 / Next 16). The design
  handoff describes the dark chrome + the matrix grid but **no** timeline/resize
  UI. The repo's own `docs/design-implementation-plan.md:85` already lists
  _"richer inline assign-on-click directly in the grid"_ as an **intended
  follow-up** — Phase 1 below is exactly that.
- **Downstream consumers of a shift's times** (why changing them is not free):
  the public roster `/r` (`rosterRows`), the availability screen `/a` (**per-shift
  yes/no, 1:1 mapping to assignments — a stated invariant in CLAUDE.md**), the
  publish emails, clock-in→shift matching (matches a shift by date), and
  "Draft from last week" (matches by template / label+times + weekday).

---

## 2. The one decision that gates everything

The ask contains two \*different\_ kinds of interaction:

| #   | Ask                                                           | Fits the current model?                                                                                                                                  |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a   | Colour-code each **employee** on the calendar                 | ✅ Yes — reuse `avatarColor`. Presentational only.                                                                                                       |
| b   | **Drag** an employee's shift **from day → day**               | ✅ Yes — it's a **re-assignment** (move the assignment to a shift on the other day). No schema change.                                                   |
| c   | **Resize** a shift to increase/decrease its length            | ⚠️ **No.** Times live on the _shift_, which is **shared** by everyone on it. Resizing one person's block means **per-assignment times** — a new concept. |
| d   | Drop a **break** (30/60 min) inside a shift                   | ⚠️ **No.** No break field exists on shifts/assignments at all. New concept.                                                                              |
| e   | A **timeline** view (block that spans 9am→9pm proportionally) | ⚠️ **No.** The grid is a fixed-height **cell** matrix, not a **time-axis**. A true proportional timeline is a different layout.                          |

So **(a) + (b)** — which _is_ the owner's stated headline goal ("rearrange a
drafted roster by dragging employees across the calendar") — fit the existing
model cleanly. **(c) + (d) + (e)** require **per-employee scheduled times +
breaks**, i.e. the shift stops being a shared slot and each person gets their own
block. That is a genuine **departure from the MVP model** and ripples through
publish / availability / clock-matching / Xero.

CLAUDE.md is explicit: _"Product scope (MVP — do not exceed without flagging)…
If a request drifts here, flag it rather than silently building it."_ This doc is
that flag. There is also a **product-fit tension**: the app's north star is
_"understandable in 5 seconds… mobile-first… zero jargon."_ A dense 7-day
time-axis with resize handles and draggable breaks is powerful but is the kind of
Deputy/When-I-Work complexity the product deliberately avoids — and it is hard to
operate on a phone. Worth a conscious call, not a silent build.

**Recommendation: ship Phase 1 first (a+b), and only build Phase 2 (c+d+e) if the
owner explicitly wants the per-employee-timeline model, with eyes open to the
ripple + the mobile cost.**

---

## 3. Phase 1 — Drag-to-rearrange + colour-by-employee (in-scope, recommended)

Delivers the headline goal with **no schema departure** and keeps the existing
tap-to-assign editor as the accessible fallback.

### 3.1 Interaction

- Make the **staff × day matrix a client island** (a new
  `src/components/RosterGrid.tsx`, `"use client"`), hydrated from the same data
  the server component already computes. The server page stays the data owner.
- **Drag a shift chip** from one `(staff, day)` cell to another cell:
  - onto **another staff member, same or different day** → move the assignment
    to the matching shift there;
  - onto the **"Open shifts"** row → **unassign** (release back to open);
  - from **"Open shifts"** onto a staff cell → **assign**.
- **Target-day resolution** (the one real edge case): a `(staff, day)` cell maps
  to the _shifts that exist on that day_. On drop we match the dragged chip's
  shift **type** (`templateId`, else label) to a shift on the target day:
  - exactly one match → assign there;
  - several matches → small **chooser popover** ("Which shift?");
  - **no shift of that type on the target day** → offer **"Create Morning shift
    on Tue and assign"** (uses `createShifts` from the originating template's
    times) or cancel. No silent creation.
- **Optimistic UI**: the chip moves immediately; a server action persists; on
  failure we roll back + toast. Uses the existing `useOptimistic` / server-action
  pattern already in the app.

### 3.2 Colour-by-employee

- Tint each chip by `avatarColor(member.id)` (soft background + solid left bar),
  keeping a **small shift-type dot/label** so type is still legible.
- A lightweight **"Colour by: Employee | Shift type"** toggle (client state only)
  so owners who prefer the current type-colouring keep it. Default: **Employee**
  (matches the ask). The `avatarColor` legend replaces the shift-type legend when
  in employee mode.

### 3.3 Persistence (repo + actions)

- Add one **atomic** repo method `moveAssignment({ fromShiftId, toShiftId,
staffMemberId })` (delete-then-insert in a single transaction, `businessId`-
  scoped, re-validating both shifts belong to the period) so a move can never
  half-apply. Reuse `assign`/`unassign` for the open-row drops.
- New server actions on the build page: `moveAssignmentAction`,
  `assignFromOpenAction`, `unassignToOpenAction`, plus `createShiftAndAssign`
  for the "no shift on that day" case. Each re-derives `businessId` from
  `requireOwner()` and validates ownership (same guard style as `toggleAssign`).
- **Suggested vs confirmed**: dragging a _suggested_ chip promotes it to
  confirmed on drop (consistent with tapping to accept). Draft-from-last-week is
  unchanged; DnD is just a faster way to accept/rearrange its output.

### 3.4 Accessibility & mobile (hard requirements)

- DnD is an **enhancement, never the only path** — the tap-to-assign editor
  stays and remains fully keyboard-operable and screen-reader labelled (WCAG AA,
  per CLAUDE.md). Chips get keyboard move affordances (e.g. focus a chip →
  "move to…" menu) so no owner is drag-only.
- Touch: use a pointer/touch-capable DnD (see §5). Long-press to pick up on
  touch, generous hit targets, auto-scroll on drag near edges.

### 3.5 Scope guardrails for Phase 1

- **No schema migration.** No change to shift times, publish, availability,
  timesheets or Xero. Purely a faster way to create/move/remove the same
  `roster_assignment` rows and to tint them.
- Only mutate on **non-published** periods in the builder (published rosters are
  handled by the existing Shifts/swap flow); the grid is read-only once
  published, exactly as now.

---

## 4. Phase 2 — Per-employee times, breaks & timeline (needs explicit sign-off)

This is what makes (c)/(d)/(e) real. **Do not build without an explicit owner
decision** — it changes the model and the product's simplicity posture.

### 4.1 Model change (the crux)

Give an **assignment its own schedule**, overriding the shift's nominal times:
add to `roster_assignment` (nullable, so existing rows are unaffected):
`start_time`, `end_time`, `break_minutes` (default 0). Null start/end = "use the
shift's times" (today's behaviour). A person's block = their assignment's
resolved `[start, end]` minus the break.

### 4.2 Ripple to settle **before** building (each needs a decision)

- **Availability** is _per-shift yes/no, 1:1 with assignments_ (CLAUDE.md
  invariant). Per-person custom times weaken that mapping — decide whether
  availability stays per-shift (likely yes) and per-person times are an
  owner-only builder concept.
- **Public roster `/r`** and **publish emails** must show the _assignment's_
  resolved times, not the shift's — the block a staff member actually works.
- **Clock-in → shift matching** matches by date today; per-person times don't
  break it but the "expected vs actual" story gets richer (out of scope to
  enforce).
- **Xero draft push / CSV / labour report** compute hours from **timesheets**
  (actual clocked time), **not** rostered times, so they are unaffected —
  **confirm** this stays true (rostered breaks must not leak into paid-hours
  maths; only clocked `break_minutes` counts).
- **"Draft from last week"** should copy the per-assignment times + breaks so a
  drafted roster reproduces last week's shaped shifts.

### 4.3 Timeline UI

- A **time-axis day view** (and/or a week view with proportional blocks): a
  vertical hour ruler per day, each assignment a coloured block sized to its
  duration, **resize handles** top/bottom to change start/end (snapped to 15/30
  min), and a **break** you drop in that splits the block visually and sets
  `break_minutes`.
- **Mobile-first cost is real**: a 7-day time-axis is dense on a phone. Likely a
  **single-day timeline** on mobile with day paging, and the week matrix (Phase
  1. as the default overview. This is the biggest UX risk and the main reason to
     confirm scope first.

### 4.4 Phase 2 guardrails

- Rostered times/breaks are **planning aids only** — never a payroll
  calculation, never enforced against clock-in (consistent with the app's
  "record, don't enforce" stance). State this wherever times show.
- Additive migration; nullable columns; zero behaviour change when unused.

---

## 5. Library choice

- **Recommended: `@dnd-kit/core`** (+ `@dnd-kit/sortable` if needed).
  Pointer/touch/keyboard sensors out of the box (covers the a11y + mobile
  requirements), tiny, no runtime network calls → **offline-build safe** (bundled
  by webpack; consistent with the repo's offline-safe posture). Add via
  `npm install`; CI's `npm ci` picks it up.
- **Alternative: hand-rolled Pointer Events** — zero new deps, but we'd
  re-implement touch handling, keyboard DnD, auto-scroll and collision detection
  that dnd-kit already does well and accessibly. Recommend **against** for a
  first cut given the a11y bar.

---

## 6. Testing

- **Phase 1**: unit-test the pure **target-day / shift-type resolution** helper
  (`chooseTargetShift(dragged, shiftsOnDay)` → one | choose | create) in
  `tests/`. Add a flow test for `moveAssignment` (atomic, tenant-scoped, no
  cross-business move, suggested→confirmed on move). The grid island is thin over
  server actions, so most logic stays pure/testable.
- **Phase 2**: pure tests for resolved-time + break maths (block sizing, break
  clamped ≥ 0, resolved times fall back to shift times when null) and the
  public-roster/publish rendering of resolved times.

---

## 7. Recommendation

1. **Build Phase 1 now** — it \*is\_ the headline ask ("rearrange a drafted roster
   by dragging employees across the calendar") + colour-by-employee, fits the
   model, needs no migration, and the design plan already earmarked it.
2. **Treat Phase 2 as a separate, opt-in project** — resize/breaks/timeline is a
   real model + UX departure; get an explicit "yes, build the per-employee
   timeline" (and accept the mobile density trade-off) before starting, and
   settle the §4.2 ripple decisions first.

Open question for the owner: **Phase 1 only, or commit to the full timeline
(Phase 1 + 2)?** That answer decides whether we touch the schema at all.
