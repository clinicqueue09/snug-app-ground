# Doctor day Schedule tab, blue theme, reschedule dialog fit

## 1. New "Schedule" tab (after Upcoming)
- Doctor pills across the top (first doctor selected by default).
- Date switcher: previous / "Today" / next, label like "Sat 7 Nov 2026", defaults to today.
- Four tiles: Seen (completed + no_show), In the room (in_consultation), Booked waiting (waiting), Free slots (slots nobody booked).
- Sessions side by side on wide screens, stacked on mobile, titled "Session 1 · 10:00 AM - 1:00 PM".
- One row per slot, time on the left:
  - Free: dashed blue border, "Free slot", "+ Book" (hidden for past slots; disabled when trial expired or doctor on leave).
  - Booked: patient name, masked phone "98••• ••321", status pill (Waiting violet, In room blue, Seen grey, No show red); waiting rows also show the existing Reschedule button.
- Bookings that fit no slot are listed under "Outside the slots / working hours".
- "+ Book" dialog: name + 10-digit phone; creates the appointment for that doctor/date/time with the same duplicate-slot and future-time checks as Add Patient, then sends the same confirmation and refreshes.
- Footer:
  - "Doctor on leave: block this day" toggle adds/removes the leave day. If patients are already waiting, ask to confirm and warn they will not be notified automatically.
  - "Print day list" opens a print window (clinic, doctor, date, slot list), with all patient text escaped.
- Uses the dashboard's existing live booking list, so it updates in real time.

## 2. Colour theme green to blue
- Shift dashboard and doctor-panel colours from teal/green to a deep blue, keeping the current darkness and contrast. Sign-in and public pages unchanged.

## 3. Reschedule / slot dialog going off screen
- Constrain the dialog width to the screen and let its contents shrink, so the date strip scrolls inside and the Save/Cancel buttons stay visible on the right.

## Technical details
- New `src/components/DoctorDaySchedule.tsx` (plus small `BookSlotDialog`), receiving clinic, doctors, tokens, trialExpired and a refresh callback from `dashboard.tsx`; Reschedule is passed in as a render prop to reuse the existing `RescheduleDialog`.
- Slot building reuses `sessionsForWeekday`, `makeSlotTimes`, `clampSlotLength` from `src/lib/scheduling.ts`; add pure helpers `slotForToken` / `maskPhone` / `escapeHtml` with tests in `tests/scheduling.test.ts`.
- Availability and time-off loaded per doctor/date from `doctor_availability` / `doctor_time_off`; leave toggle inserts/deletes the row (existing RLS allows it).
- Booking insert copies AddPatientCard's logic (token_number 0, unique-slot error handling, `dispatchNotification` confirmation) via a shared extracted helper so Add Patient behaviour is unchanged.
- Theme: change hue (~185 to ~255) in `.dashboard-theme` and `.doctor-panel` in `src/styles.css`.
- Dialog fix: `DialogContent` in RescheduleDialog gets `w-[calc(100vw-2rem)] max-w-lg min-w-0 overflow-hidden`, inner wrapper `min-w-0`; footer buttons wrap.
