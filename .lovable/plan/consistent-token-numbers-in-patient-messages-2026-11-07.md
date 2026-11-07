# Consistent token numbers in patient messages

All changes are in `src/lib/whatsapp.functions.ts`. The database, dashboard screens, message limits and the WhatsApp-or-SMS choice stay as they are.

## What changes for patients
- **SMS shows the same token number as WhatsApp and the dashboard.** That number is the patient's place in line by appointment time, not the order they booked in. This applies to the reported, queue update, next in line, doctor arrived and shift update texts. The wording stays the same.
- **First message (confirmation):**
  - Visit on a later day: no token number. WhatsApp adds "Your token number will be sent on the day of your visit." SMS adds "Token no. will be sent on the day of your visit."
  - Visit today: WhatsApp adds "Your token today: #N (may change if earlier slots are booked)". SMS adds "Token today: #N."
  - The rest of the message stays the same.
- **24-hour reminder:** the token line is removed from both WhatsApp and SMS. Date, time, clinic, location and signature stay.
- **Rescheduled:** still no token number. It gets the same today or later-day line as the first message, based on the new date.
- **Messages on the day of the visit** keep their token numbers. Bulk doctor-arrived and queue-advance already use the place-in-line number, so I'll confirm that and leave them as they are.

## Technical details
- Add `todayISTString()`, which returns the date as yyyy-MM-dd in the Asia/Kolkata timezone using `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" })`.
- In `dispatchNotification`, compute `computeQueueContext` lazily once per call and share it between the WhatsApp and SMS branches. Set `rank = ctx.displayToken.get(t.id) ?? t.token_number`.
- Add an optional `tokenNote?: string | null` field to the `buildMessage` params. It prints under the date/time line for the `confirmation` and `rescheduled` variants only.
- Remove the tokens text from the `reminder_24h` case and remove `${tokenLine}` from the SMS reminder.
- In the SMS branch, every `tokenLine` uses `rank`.
- Add tests for `todayISTString` near midnight in UTC and for the today/later-day note choice.
