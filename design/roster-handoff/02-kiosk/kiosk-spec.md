# 02 · Kiosk clock-in — per-screen spec

**Surface:** in-venue shared tablet at `/kiosk/:tenant`. **Primary width:** tablet
~768 (also render fine wider — it's a centered `max-width:620px` column). **Chrome:**
standalone, full-screen **dark** theme, no app nav. Radial bg `#1a2335 → #0E1320`.
Large touch targets (keypad keys **70px**). Header: brand mark (Leaf `grid_view` +
"ROSTER", Leaf `#5FA875`) + "Kiosk"; then centered tenant "Troy's Kebabs" + "Mon 23
Jun · 11:42 am".

Screenshots: `screens/kiosk-<state>.png`; PIN pad block in `blocks/pin-pad.png`.

This is a **state machine** (`kiosk.step`): `pick → pin → (wrong | locked) → actions
→ (confirm | gps)`. Build each as a distinct view within one route.

---

### 1. Pick — `screens/kiosk-01-pick.png`
"Tap your name to start" → 3-col grid (`kioskgrid`, → 2-col at ≤600) of staff tiles
(`#1C2433`/`1px #2A3344`, 52px avatar + first name; hover border→Leaf). Below: an
"On shift now" card — green live dot + "3 clocked in" + pill chips (avatar + first
name + "since …") for staff currently on shift.

### 2. PIN — `screens/kiosk-02-pin*.png`, `blocks/pin-pad.png`
"Enter your PIN" + selected first name (Leaf). 4 dot indicators fill Leaf `#5FA875`
as digits are typed. **PIN pad ★:** `repeat(3,1fr)`, keys 70px; bottom row Cancel
(text) · 0 · backspace. **Auto-submits at 4 digits.** Capture both empty and
partially-entered dot states.

### 3. Wrong PIN — `screens/kiosk-03-wrong.png`
Red panel (`#3B1414`/`#7F1D1D`), `lock` icon, "That PIN didn't match", "Give it
another go. **{N} tries left** before this kiosk locks for a minute." · "Try again"
(white) · "← Not you? Start over". (attemptsLeft = 5 − attempts.)

### 4. Locked — `screens/kiosk-04-locked.png`
Neutral dark panel, `timer_lock`, "Locked for a moment", "Too many wrong PINs. For
everyone's security this kiosk pauses briefly — no need to worry." + a 120px
countdown ring showing remaining **seconds** (Leaf number). Auto-releases.

### 5. Actions — `screens/kiosk-05-actions.png`
"Hi {first} 👋" / "What would you like to do?" → big Leaf **Clock In** (login icon)
+ 2×2 grid Clock Out / Request Leave / Stock Check / Shift Swap (dark tiles) +
"← Not you? Start over".

### 6. Confirm — `screens/kiosk-06-confirm.png`
Green success panel (`#14532D`/`#166534`), filled `check`, "Clocked in", "{name} ·
11:42 am", "Done", "Returning to start in {count}s…" (auto-resets on countdown).

### 7. GPS blocked — `screens/kiosk-07-gps.png`
Red panel, `wrong_location`, "Clock-in blocked", "You appear to be outside the
clock-in area — **320m away**, limit 200m. Please see your manager." + "Back to
start". (Marcus triggers this path in the demo.)

**Components:** PIN pad ★, staff tile, dark Button (Leaf primary), success/danger
panels, countdown ring. **Interaction states to build:** default keypad · dot-fill
(0–4) · wrong-PIN retry (with tries-left) · lockout countdown · actions menu ·
clock-in confirm w/ auto-reset · GPS-blocked. **Copy stays reassuring & non-punitive.**
**Focus rings on this dark surface are blue (`--focus-blue`).**
