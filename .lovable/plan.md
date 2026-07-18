## Goal
Route the 24-hour reminder cron (`src/routes/api/public/hooks/whatsapp-reminders.ts`) through the same opt-in-aware dispatcher used by the five in-app touchpoints, so cron reminders honor `whatsapp_optins` and fall back to Fast2SMS when the patient hasn't opted in or the clinic's WhatsApp isn't connected.

## Why the current code can't just `notifyPatient(...)`
- `notifyPatient` in `src/lib/whatsapp.functions.ts` is gated by `requireSupabaseAuth` — the cron webhook is public and has no user session, so calling it would 401.
- `notifyPatient` also doesn't yet know about the `reminder_24h` message type (it currently maps only confirmation / reported / queue_update / next_in_line / doctor_arrived) and its per-variant gating doesn't check `reminder_24h_sent_at`.

## Changes

### 1. Extract the dispatcher into a shared, auth-agnostic helper
In `src/lib/whatsapp.functions.ts`:
- Add `export type NotifyType = "confirmation" | "reported" | "queue_update" | "next_in_line" | "doctor_arrived" | "reminder_24h"`.
- Extract the body of `notifyPatient.handler` into `export async function dispatchNotification(supabase: SupabaseLike, input: { tokenId; messageType: NotifyType; tentativeTime?: string | null })`. The function takes any Supabase client (user-scoped or `supabaseAdmin`) so it works from both auth-gated server fns and the public webhook.
- Extend the internal logic:
  - Add `reminder_24h` to `waVariantMap` → `"reminder_24h"`.
  - Add gating: if `messageType === "reminder_24h"` and `t.reminder_24h_sent_at` is set, return early (already sent).
  - Add a compact SMS branch for `reminder_24h`:
    `"Hello {name}, reminder — your appointment at {clinic} with {doc} is tomorrow. Date: {date} | Time: {time}. Token #{token}. — Powered by ClinicQ"`.
  - On success for `reminder_24h`, also patch `reminder_24h_sent_at = now()`.
- `notifyPatient` becomes a thin wrapper that calls `dispatchNotification(context.supabase, data)`.

### 2. Rewrite the reminders route to use the dispatcher
In `src/routes/api/public/hooks/whatsapp-reminders.ts`:
- Drop the local `postToGateway`, `buildMessage`-style string, `MAX_TOTAL_MESSAGES`, and the `clinic.whatsapp_connected` gate.
- Keep the existing 24h ±15 min windowing to pick candidate tokens (`status = waiting`, `reminder_24h_sent_at IS NULL`, `appointment_date` in the two-day window, and per-row `combineDT` check).
- For each surviving token, `await dispatchNotification(supabaseAdmin, { tokenId: t.id, messageType: "reminder_24h" })`.
- Count `sent` from `result.ok === true`; return `{ ok: true, sent }`. `reminder_24h_sent_at` and `whatsapp_messages_sent` are now maintained inside the dispatcher, so the route no longer writes them itself.
- Since the dispatcher already looks up clinic / doctor / opt-in per token, we no longer need the batch `clinics` + `doctors` prefetch — remove it.

### 3. No schema changes
Existing `whatsapp_optins`, `tokens.whatsapp_messages_sent`, and `tokens.reminder_24h_sent_at` cover everything.

### 4. No UI or call-site changes elsewhere
`sendWhatsAppMessage` still exists for legacy paths and keeps its old behavior. Dashboard call sites continue to use `notifyPatient` unchanged. Only the cron path switches.

## Files touched
- `src/lib/whatsapp.functions.ts` — extract `dispatchNotification`, add `reminder_24h` support, keep `notifyPatient` as wrapper.
- `src/routes/api/public/hooks/whatsapp-reminders.ts` — call `dispatchNotification(supabaseAdmin, ...)` per token; delete gateway/message helpers now living in the shared file.

## Verification
- Trigger the cron endpoint against a clinic where opt-in exists → sends via WhatsApp gateway, increments counters, stamps `reminder_24h_sent_at`.
- Trigger against a clinic with no opt-in row (or `whatsapp_connected = false`) → sends via Fast2SMS, same stamping.
- Trigger twice → second call returns 0 sent because `reminder_24h_sent_at` is now set.
