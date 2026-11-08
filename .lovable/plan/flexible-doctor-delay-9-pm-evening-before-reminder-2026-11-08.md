# Flexible doctor delay + 9 PM evening-before reminder

Nothing else changes: other message types, WhatsApp-or-SMS routing, the 7-message cap for other messages, and the cron job and its secret all stay as they are.

## Part 1: Doctor delay at any time of day

**Database:** add `notified_delay_minutes` and `notify_count` (both integer, not null, default 0) to `doctor_shift_status`. RLS and grants stay the same. From now on, `delay_minutes` holds the total delay for the day.

**Server (`applyDoctorShiftStatus` in `src/lib/whatsapp.functions.ts`):**
- Takes `{ doctorId, deltaMinutes }`, a whole number from -480 to 480 that can't be 0. The 45-minute rule is removed.
- Uses India time: `todayISTString()` from `src/lib/token-note.ts` and a new `nowISTMinutes()`.
- Reads today's row for the doctor (cur = 0 if there isn't one). New total = cur + delta, and it must stay between 0 and 480. Otherwise it returns "Delay can't be less than 0 or more than 480 minutes".
- Moves only today's "waiting" tokens by the delta. If any new time would land outside 00:00–23:59, it changes nothing and returns an error. Updates run latest-first when the delta is positive and earliest-first when it's negative. A token that clashes with the unique slot index is skipped and counted.
- Saves today's row: status `delayed` or `on_time`, plus the new total. This happens even when nobody is waiting.
- Notifications: pending = |new total - notified_delay_minutes|. Under 10 minutes, nobody is messaged. At 10 or more, while `notify_count` is below 6, every moved patient gets `shift_update`, then `notified_delay_minutes` = new total and `notify_count` goes up by 1. When `notify_count` has reached 6, times still move but nobody is messaged, and `capReached` is set.
- Returns `{ ok, cumulative, shifted, notified, skipped, capReached }`.

**Dispatcher:** for `shift_update` only, skip the 7-message cap check and don't increase `whatsapp_messages_sent`. This applies in `dispatchNotification` and the older send path.

**Wording (WhatsApp and SMS):** "Doctor is running about N minutes late. Your updated tentative time: {time}." When the total is 0: "Doctor is back on schedule. Your tentative time: {time}." The signature and disclaimer stay.

**Dashboard (DailyShiftPanel / ShiftDoctorCard):**
- New help text: "Running late? Add a delay at any time. Patients are only messaged when the change reaches 10 minutes."
- Badge: amber "Running N min late" or green "On time".
- Buttons: Add delay, Reduce delay (can't go below 0), and Back on time (only shown when there is a delay). The dialog has +10, +15 and +30 chips and a number field.
- After each change, a toast shows the new delay, how many patients moved and were messaged, how many couldn't be moved, and the limit note if reached.
- Buttons wrap and the dialog scrolls on phones.

**Schedule tab:** for today, read the doctor's row and show an amber note "Running about N min late" under the date line when there is a delay.

## Part 2: Reminder at 9 PM the evening before

In `src/routes/api/public/hooks/whatsapp-reminders.ts`:
- Outside 21:00–22:59 India time, return `{ ok: true, sent: 0, reason: "outside reminder window" }` without querying anything.
- Otherwise, find tomorrow's (India date) waiting tokens that haven't had a reminder and send each through `dispatchNotification("reminder_24h")`. Failed sends are retried on the next 15-minute run.
- The old "24 hours ahead" window is removed.
- New wording (WhatsApp and SMS): "Reminder: your appointment at {clinic} with {doctor} is tomorrow. Date: {date} | Time: {time}." Location, signature and disclaimer stay, with no token number.

## Tests
Add tests for `nowISTMinutes`, tomorrow's India date, the 9 PM window check, and the delay rules: the 0–480 limit, the 10-minute message threshold, and the cap of 6. The rules live as pure helpers in `src/lib/token-note.ts` or a small `src/lib/doctor-delay.ts`.
