## Goal

Two changes to the receptionist dashboard:
1. A "rescheduled" notification routed through the central opt-in-aware dispatcher, sent after every successful reschedule, and the doctor shift/delay flow moved onto the same dispatcher so non-opted-in patients get SMS.
2. The Upcoming tab becomes a compact, chronologically ordered list grouped under date headings.

## Part 1 — "rescheduled" notification (`src/lib/whatsapp.functions.ts`)

- Add `"rescheduled"` to `NotifyType` and `"rescheduled"` to `Variant`.
- `waVariantMap`: `rescheduled → "rescheduled"`.
- `buildMessage()` new case:
  `Hello {patient}, your appointment at {clinic} with {doc} has been rescheduled.\nNew date: {date} | New time: {time}\n{location}\n\n{DISCLAIMER}` — wrapped with `withSig` like the other variants.
- New SMS branch in `dispatchNotification` for `rescheduled`:
  `Hello {patient}, your appointment at {clinic} with {doc} has been rescheduled to {date} | {time}.` + `SIGNATURE`.
- Counters: `whatsapp_messages_sent` is incremented (the dispatcher already does this for every successful send); `token_update_count` is NOT incremented — the existing `token_update_count` patch only fires for `queue_update`/`reported`, so no change needed there.
- Routing stays as-is: WhatsApp when the phone is in `whatsapp_optins` and the clinic is connected, otherwise Fast2SMS. No new gating (reschedule can repeat).

### RescheduleDialog (`dashboard.tsx`, ~line 831)

- Add `const notify = useServerFn(notifyPatient);` inside `RescheduleDialog`.
- After the token update succeeds (before closing the dialog), call
  `await notify({ data: { tokenId: token.id, messageType: "rescheduled" } })`.
- On `res.ok`: `toast.success("Rescheduled — patient notified by WhatsApp/SMS")` when `res.channel === "whatsapp"`, `"Rescheduled — patient notified by SMS"` when `"sms"`.
- On `!res.ok`: keep the plain `toast.success("Rescheduled")` plus `toast.warning(res.error)` — the reschedule itself must never fail because the message failed.
- Existing duplicate-slot / DB-error toasts unchanged.

### Doctor shift/delay flow (`applyDoctorShiftStatus`)

It still calls `postToGateway` directly, so:
- Add `"shift_update"` to `NotifyType` (the `Variant` already exists), `waVariantMap: shift_update → "shift_update"`, and an SMS branch:
  `Hello {patient}, doctor shift is delayed by {delayMinutes} minutes at {clinic}. Your tentative time: {time}. Token #{token}.` + `SIGNATURE` (on-time case: "Doctor shift is on time." without delay).
- Replace the WhatsApp-only send loop with per-token `dispatchNotification(supabase, { tokenId: t.id, messageType: "shift_update", tentativeTime })` after the appointment times are shifted. `tentativeTime` = the new shifted time in 12-hour format.
- Return `{ ok, sent, shifted, ... }` counting `result.ok === true` so the existing dashboard toast keeps working. `whatsapp_messages_sent` is maintained by the dispatcher.

## Part 2 — Upcoming tab layout (`dashboard.tsx`)

- New `upcomingTokens` ordering: by `appointment_date` ascending, then `appointment_time` (nulls last, `created_at` tiebreak) — not today's time-only `sortAndTokenize`.
- Replace the `QueueTable` in the Upcoming tab with a compact grouped list component (`UpcomingList`):
  - Rows grouped under a small date heading (`EEE d MMM`, e.g. "Tue 4 Nov") when several share a day; heading shown once per day.
  - Each row: 12-hour time (`formatDisplay`, e.g. "3:00 PM"), patient name, doctor name — tight single line, small paddings.
  - Keep all action buttons (Reported / Start / No Show / Reschedule) but compact (existing `h-7` ghost buttons, fewer actions shown on narrow screens).
  - Empty state "No upcoming appointments." unchanged; loading state preserved.
- Today and History tabs unchanged.

## Files touched

- `src/lib/whatsapp.functions.ts` — new `rescheduled` + `shift_update` types, message texts, SMS branches; `applyDoctorShiftStatus` rewritten to use `dispatchNotification`.
- `src/routes/_authenticated/dashboard.tsx` — `RescheduleDialog` notification + toasts; new `UpcomingList` replacing the Upcoming tab's `QueueTable`.

No schema changes — `tokens`, `whatsapp_optins`, counters all cover this.

## Verification

- Typecheck and build pass.
- Playwright against the preview: reschedule an upcoming appointment → success toast mentions the channel; verify the token's `whatsapp_messages_sent` increments and `token_update_count` does not.
- Trigger a doctor delay → waiting patients get WhatsApp or SMS depending on opt-in; counters maintained by the dispatcher.
- Upcoming tab: rows sorted earliest date then time, one date heading per shared day, 12-hour times, on desktop and mobile viewport.
