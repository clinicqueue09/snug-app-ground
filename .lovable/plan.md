## Clinic System Upgrade — Doctor-level avg time, dashboard controls, message rules

Delivered in 5 blocks. Block 1 (schema) ships first for approval; UI + logic follow after the migration lands.

---

### Block 1 — Database schema

Single migration on the built-in database:

- **`clinics`** — already has `name NOT NULL`, `address NOT NULL`, `clinic_mobile` (optional, 10-digit CHECK). No changes needed; the existing clinic-level `avg_time_per_patient` stays as a fallback default for new doctors.
- **`doctors`**
  - `name` → `NOT NULL` (already is)
  - `specialty` → `NOT NULL` (currently nullable). Backfill empty/NULL rows with `"General"` first.
  - Add `avg_time_per_patient INT NULL` — optional, per-doctor override in minutes. NULL means "no calculated time in token-update messages" per your spec.
- **`tokens`** — already enforces `patient_name NOT NULL` and `phone_number` 10-digit CHECK. Also already has `whatsapp_messages_sent`, `reminder_24h_sent_at`, `doctor_arrived_sent_at`, `last_position_notified`, `token_update_count` from the previous pass — reused as-is. No changes needed.
- No trigger changes; `handle_new_user` already captures `clinic_name` + `clinic_address` from signup metadata.

### Block 2 — Auth & profile (already in place — verify only)

- Sign-up form already mandates Clinic Name + Clinic Address (`/auth`).
- `/forgot-password` + `/reset-password` routes already exist and use `resetPasswordForEmail` + `updateUser({ password })`.

No code changes in this block unless verification finds a gap. I'll only touch it if a field is missing or the reset flow is broken.

### Block 3 — Booking form time picker (already in place — verify only)

`src/components/TimeSelect.tsx` already provides Hour (1–12) / Minute (00/15/30/45) / AM-PM dropdowns and is wired into Add Patient + Reschedule. Strict 10-digit phone validation is also in place. No changes unless verification finds a gap.

### Block 4 — Receptionist Dashboard

- **Header**: render the full `clinic_address` prominently under the clinic name in the dashboard header (currently only the clinic name shows).
- **Doctor Controls strip** (new section at top of dashboard, above the queue):
  - One card per active doctor showing name + specialty.
  - Inline numeric input bound to `doctors.avg_time_per_patient` (blank = inherit clinic default). Save on blur / Enter via `supabase.from('doctors').update()`.
  - Per-doctor **"Doctor Arrived"** button. Fires Message 3 for every today's waiting token belonging to that doctor (server fn hard-checks `appointment_date === today`, per-token dedupe via existing `doctor_arrived_sent_at`).
- **Queue rows**: keep the existing inline editing for `patient_name` and `appointment_time`; ensure `appointment_time` stays visible at every breakpoint (drop the `hidden lg:table-cell` on that column).

### Block 5 — WhatsApp cap + message rules

All logic in `src/lib/whatsapp.functions.ts`. Central `sendCapped()` helper stays: refuses ≥ 7 total, increments on success.

- **Message 1 (Confirmation)** — extend payload to include `Dr. [Name] ([Specialty])` (currently just `Dr. [Name]`). Disclaimer already included.
- **Message 2 (24h Reminder)** — add `pg_cron` job every 15 min → POSTs `/api/public/hooks/whatsapp-reminders` (auth via `apikey` header, no new secret). Handler picks tokens where `appointment_date + appointment_time` is 23h45m–24h15m away, `reminder_24h_sent_at IS NULL`, status = waiting. Uses `supabaseAdmin` for the batch write.
- **Message 3 (Doctor Arrived)** — new server fn `sendDoctorArrivedForDoctor({ doctorId })`. Loads today's waiting tokens for that doctor, server-side re-checks each token's date == today, sends one message per token, sets `doctor_arrived_sent_at`. Rejects if not today.
- **Messages 4–6 (Token Updates)** — reuse existing `advanceQueueNotifications` with two changes:
  1. Read `avg_time_per_patient` from **the doctor**, fall back to clinic value only if doctor is NULL. If both NULL → send the update **without** any calculated time (message builder branch: omit the "tentative time is X" sentence but keep the disclaimer).
  2. Keep the adaptive gap: at most 3 updates per patient, immediate-next always attempts subject to the 7-message cap.

### Technical notes

- Migration order per rule: ALTER → RLS unchanged → policies unchanged. Existing GRANTs already cover the new `doctors.avg_time_per_patient` column.
- pg_cron + pg_net already available; new endpoint uses `apikey` header pattern (no custom secret).
- Reschedule preserves token number (unchanged).
- Doctor edits use existing RLS on `doctors` (receptionist scoped to clinic).
- Message 3 button is per-doctor, not per-row — one click notifies all of that doctor's today waiting patients at once.

I'll ship Block 1 (schema) first for your approval, then move through 2 → 5. Ready to start?