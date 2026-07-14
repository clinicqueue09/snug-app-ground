## Clinic System Upgrade — Schema, Auth, Booking Form, Dashboard Edit, Message Cap

Delivered in 5 blocks. Each block ships schema + code together where sensible; I'll pause after Block 1 for you to review the migration before I touch UI.

---

### Block 1 — Database schema

Single migration on the built-in database:

- **`clinics`**
  - `name` → `NOT NULL`, backfill any empty rows with `"My Clinic"` first
  - `address` → `NOT NULL`, backfill empty rows with `"—"` (we'll force users to fix on next sign-in via a one-time profile-complete gate)
  - Add `clinic_mobile TEXT` — optional, CHECK `clinic_mobile IS NULL OR clinic_mobile ~ '^[0-9]{10}$'`
  - Add `avg_time_per_patient INT NOT NULL DEFAULT 10` (minutes) — mandatory, used for tentative-time math
- **`tokens`**
  - `patient_name` → `NOT NULL` (already is)
  - `phone_number` → `NOT NULL` + CHECK `phone_number ~ '^[0-9]{10}$'` (strict 10 digits)
  - Add `whatsapp_messages_sent INT NOT NULL DEFAULT 0` — global cap counter (max 7)
  - Add `reminder_24h_sent_at TIMESTAMPTZ` — de-dupe the 24h reminder
  - Add `doctor_arrived_sent_at TIMESTAMPTZ` — de-dupe Message 3
  - Add `last_position_notified INT` — powers the "adaptive gap" so at most 3 token-update messages fire and the immediate-previous one always goes
- Rewrite `handle_new_user()` trigger to also read `clinic_address`, `clinic_mobile`, `avg_time_per_patient` from `raw_user_meta_data` when present (falls back to defaults so existing accounts still work)

### Block 2 — Auth & Clinic Profile

- **Sign-up form (`/auth`)**: add mandatory Clinic Name, Clinic Address, mandatory Avg Time per Patient (minutes), optional 10-digit Clinic Mobile with regex validation. All passed via `signUp({ options: { data: {...} } })` so the trigger picks them up.
- **Forgot Password**: new `/forgot-password` public route → `supabase.auth.resetPasswordForEmail(email, { redirectTo: ${origin}/reset-password })`.
- **Reset Password**: new `/reset-password` public route → detects `type=recovery` in URL hash, shows new-password form, calls `supabase.auth.updateUser({ password })`, then routes to `/dashboard`.
- **Clinic Profile dialog** in dashboard header (gear icon): edit name, address, mobile, avg_time_per_patient post-signup (also used to force-complete address for legacy accounts).

### Block 3 — Booking Form time picker

Replace the current `<input type="time">` in `AddPatientCard` with three shadcn `Select`s:

- Hour: 1–12
- Minute: 00, 15, 30, 45
- Meridiem: AM / PM

Stored as `HH:MM` 24h in `appointment_time` (converted on submit). Same three-picker set replaces the time input in the Reschedule dialog for consistency.

Phone validation on the form tightens to match the DB CHECK (strict 10 digits, no spaces).

### Block 4 — Receptionist Dashboard (editable rows)

- Add **inline editing** to each queue row: click patient name → inline text input; click time cell → mini popover with the same 3-select time picker; save on blur / Enter. Uses direct `supabase.from('tokens').update()` (RLS already scopes to clinic).
- `patient_name` and `appointment_time` stay visible on every row at every breakpoint (currently `appointment_time` is `hidden lg:table-cell` — dropping the hide class).
- New **"Doctor Arrived"** button on today's rows only (see Block 5 rules).

### Block 5 — WhatsApp cap + message rules

All logic in `src/lib/whatsapp.functions.ts` (server fn, RLS-scoped). Central `sendCapped()` helper: reads `tokens.whatsapp_messages_sent`, refuses if ≥ 7, increments atomically on success.

Message shapes (all include clinic name, doctor, date, time, clinic address, optional clinic mobile; token-update + confirmation include the tentative-time disclaimer):

1. **Confirmation** — fires on Add to Queue (already wired; extend payload + append disclaimer).
2. **24h Reminder** — new pg_cron job (SQL) every 15 min → POSTs `/api/public/hooks/whatsapp-reminders` (auth via `apikey` header). Handler picks tokens where `appointment_date + appointment_time` is 23h45m–24h15m away, `reminder_24h_sent_at IS NULL`, status = waiting. Uses `supabaseAdmin` for the batch write.
3. **Doctor Arrived** — new button on dashboard row. Server fn hard-checks `token.appointment_date === today` (server-side, not just client). Rejects past/future with a clear toast. Sets `doctor_arrived_sent_at`.
4–6. **Token Updates** — triggered when queue advances (any row status change to `completed` / `no_show` / `in_consultation`). Server fn recomputes each waiting patient's queue position for that doctor+date, computes `tentative = now + position × avg_time_per_patient`, then decides who to notify using the adaptive gap:
   - Never send if `whatsapp_messages_sent ≥ 7`.
   - Never send more than 3 token-update messages per patient (tracked via a new `token_update_count` column — will add in the same migration as Block 1 so schema stays in one pass).
   - Always send when the patient becomes the **immediate next** (position = 1) even if it'd be their 4th update — cap of 3 applies to earlier updates, this one is guaranteed subject only to the global 7 cap.
   - Otherwise send when `position` has decreased since `last_position_notified` by ≥ `ceil(remaining_updates_budget)` (adaptive gap: fewer updates left → bigger jumps required). Simple, deterministic, no runaway messages.

### Technical notes

- Schema migration order per rule: CREATE/ALTER → GRANT (unchanged) → RLS (unchanged) → policies. Existing GRANTs already cover new columns.
- Trigger rewrite for `handle_new_user` runs `SECURITY DEFINER` (existing pattern).
- pg_cron + pg_net enabled once; endpoint uses the `apikey` header pattern from schedule-jobs knowledge — no new custom secret.
- All WhatsApp sends go through the existing tunnel URL in `clinic_settings`; no changes to the tunnel contract.
- Reschedule preserves token number (unchanged from prior behavior).
- Editable rows use existing RLS — no policy changes needed.

I'll ship Block 1 (schema) first for your approval, then move through 2 → 5. Ready to start?
