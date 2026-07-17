# 03 · Staff phone — per-screen spec

**Surface:** staff personal-phone pages. **Primary width:** mobile ~375 (render in a
phone device frame; content is a single scrolling column). Three routes, all PIN-gated
or standalone. Two visual languages: the **clock-in** page shares the kiosk's dark,
large-touch language; `/me` and `/a` use the light brand tokens.

Screenshots: `screens/<screen>-mobile.png` (+ state variants).

---

### Phone clock-in `/clock/:tenant` — screens/phoneclock-*
- **Purpose:** personal-phone equivalent of the kiosk. Dark (`#0E1320` radial), header brand + "Troy's Kebabs".
- **Idle:** avatar + "Hi Sarah" + "Enter your PIN to clock in or out"; a **GPS pill** (toggles near/far in the demo — `pToggleFar`); 4 dot indicators; PIN pad ★ (dark, keys 62px). When 4 digits entered → shows **Clock In** (Leaf) + **Clock Out** (dark) + "← Re-enter PIN".
- **Clocked in** (`phone.isIn`): green panel, filled `check`, "You're clocked in", "Sarah Hassan · 11:42 am", "Morning shift · 8:00am – 2:00pm / Have a great one 👋", "Done".
- **Clocked out** (`phone.isOut`): neutral panel, "You're clocked out", "Sarah Hassan · 4:02 pm", "Recorded ~6h 20m today. Hours are sent to your manager to review — **this is not a pay calculation.**", "Done".
- **Blocked** (`phone.isBlocked`): red panel, `wrong_location`, "Too far to clock in", "You're about **320m** from Troy's Kebabs — outside the 200m clock-in area. Move a little closer, or ask your manager to clock you in for you." + "Out of range" pill + "Back".
- **States:** idle (pin entry) · ready (in/out buttons) · in · out · blocked. Focus rings blue.

### Staff notices `/me` (PIN-gated) — screens/menotices-*
- **Locked:** dark tile `lock` (Leaf), "Your notices", "Enter your PIN to view", 4 dots + light PIN pad ★ (white keys, hover `#ECF3EE`).
- **Unlocked → hub** (`meView:hub`): header avatar + "Hi Sarah" + role·tenant + lock button. Sections: **Upcoming shifts** (tint-tile + shift-dot rows); a **2×2 quick-action grid** — Availability, Request leave, Shift swaps (red count badge 1), Forms (badge 2); **Forms to complete** rows (due chips, urgent = amber); **Notices** list ("Mark all read" + notice cards: tinted icon, title + unread blue dot, body, mono detail chip, timestamp; tap toggles read).
- **Form sub-view** (`meView:form`): "New starter onboarding", "Takes about 3 minutes. Your answers go straight to Troy." — rendered fields (text/date/choice chips, required `*`), "Submit form", footer "Stored in the owner's Google Drive, not on Roster."
- **Swap sub-view** (`meView:swap`): "Someone wants you to cover" offer card (who + day/type/time, Accept/Decline) + "Offer one of your shifts" list (each with "Offer swap" → toast "Swap offered — {day} posted to the team").
- **States:** locked · hub · form · swap; notice read/unread; form-todo urgent/normal.

### Availability `/a` (staff) — screens/availability-*
- **Purpose:** submit next-week availability. **Not-submitted:** eyebrow "Next week", "Your availability", "Tap each day so your manager can build the roster around you."; per-day card (day+date) with a 3-way choice grid Available / Partial / Off (`availOpts`; selected fills the option colour). "Send availability" (Forest, `send`).
- **Submitted** (`availSubmitted`): centered success check, "Availability sent", "Your manager can now build next week's roster around you. We'll notify you when it's published.", "Update availability" (resets).
- **States:** editing · submitted. Tap targets ≥44px; focus rings blue.

**Components:** PIN pad ★ (dark + light), phone hub cards ★, choice chips, dark/light
Button, notice card, success/danger panels.
