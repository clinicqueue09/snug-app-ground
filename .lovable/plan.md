## ClinicQ — Final Architecture, UI, Security & Notifications Pass

Sequenced across schema → auth UI → subscription/trial → centralized WhatsApp → dashboard/queue → shift buffer → messaging payloads → feedback loop. Delivered as one migration + code changes. Super Admin is a new role; feedback + global tunnel URL live behind it.

---

### Block 1 — Schema & role model (single migration)

- **`app_role` enum** (new): `super_admin`, `receptionist`. **`user_roles`** table (`user_id`, `role`) + `has_role(uuid, app_role)` SECURITY DEFINER + RLS + grants (per project user-roles rule).
- **`clinics`**: trial length constant becomes 21 days (default `trial_ends_at = now() + interval '21 days'` on new signups; existing rows untouched unless user asks to backfill).
- **`doctors`**: keep existing `avg_time_per_patient INT NULL` (already added).
- **`tokens`**: add UNIQUE partial index on `(clinic_id, doctor_id, appointment_date, appointment_time) WHERE status <> 'cancelled'` to hard-block double-booking. Drop reliance on stored `token_number` as source of truth — keep column for legacy but compute display token from chronological row index (see Block 4). No trigger renumber needed.
- **`clinic_settings`**: drop `tunnel_url` column (centralized now). Migration guards for existing data.
- **`app_settings`** (new, single-row keyed by `id='global'`): `whatsapp_tunnel_url TEXT`, `updated_at`. RLS: SELECT/UPDATE only via `has_role(auth.uid(),'super_admin')`. Grants to authenticated + service_role.
- **`feedback`** (new): `id`, `clinic_id`, `user_id`, `user_role TEXT`, `message TEXT NOT NULL`, `created_at`. RLS: receptionist can INSERT for own clinic; SELECT only for `super_admin`. Grants per rule.
- **`doctor_shift_status`** (new): `id`, `clinic_id`, `doctor_id`, `shift_date`, `status` (`on_time`|`delayed`), `delay_minutes INT`, `created_by`, `created_at`. UNIQUE `(doctor_id, shift_date)`. RLS scoped to clinic via `current_clinic_id()`.
- **`handle_new_user()`**: stop reading `avg_time_per_patient` from signup metadata; default clinic `avg_time_per_patient` to 10. Keep clinic name/address/mobile capture.
- **Renewal reminder cron**: `pg_cron` job daily → POST to new `/api/public/hooks/renewal-reminders` that finds clinics whose `trial_ends_at` or `subscription_ends_at` is exactly 7 days out and inserts an in-app notification row (see below).
- **`platform_notifications`** (new): `id`, `clinic_id`, `kind`, `title`, `body`, `read_at`, `created_at`. RLS: receptionist SELECT/UPDATE scoped by `current_clinic_id()`. Cron inserts via service role.

### Block 2 — Auth UI (`src/routes/auth.tsx`, `forgot-password.tsx`, `reset-password.tsx`)

- Remove `avg_time_per_patient` field from sign-up form + metadata payload.
- Address label + placeholder: **"Full Clinic Address / Google Map Link"**.
- Post-signup toast: exactly **"Account created, verify your email"**.
- Password fields: add show/hide eye toggle (lucide `Eye`/`EyeOff`) on Login, Sign-Up, and Reset Password panels.

### Block 3 — Doctor profiling + patient entry

- **Manage Doctors dialog** (in dashboard): add optional numeric `avg_time_per_patient` input per doctor row (blank = inherit clinic default). Persist via existing `doctors` update.
- **Add Patient / Reschedule forms**: make `doctor_id` mandatory (required select, no "unassigned" option). Block submit if empty.

### Block 4 — Dashboard queue logic (`_authenticated/dashboard.tsx`)

- **Sorting**: queue rows sorted strictly by `appointment_time ASC` (then `created_at` tiebreak). Display token = `index + 1` of the sorted filtered list (per doctor per day). Stored `token_number` becomes a fallback only.
- **Insert between slots**: Add Patient supports arbitrary `appointment_time`; on save, chronological sort auto-recomputes display tokens for all subsequent rows. No manual renumber UI needed.
- **Double-booking guard**: pre-check on submit + surface Postgres unique-violation as a toast ("This slot is already booked for this doctor").
- **Row edits**: keep inline editing of name/time; time edits re-run double-booking check.
- **Remove per-row "Doctor Arrived"** button from `DoctorControlCard` / row cards. Consolidate into a single **Global Doctor Controls** panel at top of dashboard (one card per active doctor, single "Doctor Arrived" button, existing per-doctor avg-time editor stays).

### Block 5 — Shift Status & Delay panel

- New **"Daily Shift"** tab/panel at dashboard level, one section per active doctor for today.
  - **Confirm On-Time** and **Declare Delay (minutes)** buttons.
  - Enabled only if `now() <= firstAppointmentToday - 45min` per doctor; otherwise disabled with tooltip.
  - On **Delay**: (a) insert `doctor_shift_status` row; (b) UPDATE all today's waiting tokens for that doctor: `appointment_time = appointment_time + delay`; (c) trigger WhatsApp update to every affected patient via existing capped sender (see Block 7); (d) toast summary.
  - On **On-Time**: insert status row + optional confirmation broadcast (subject to 7-msg cap).

### Block 6 — Centralized WhatsApp gateway

- Remove **WhatsApp Settings** dialog / tunnel URL field from the receptionist dashboard entirely.
- New **Super Admin** route `/_authenticated/admin/whatsapp` (gated by `has_role(uid,'super_admin')`; non-admins redirected). Single input to set `app_settings.whatsapp_tunnel_url`.
- `src/lib/whatsapp.functions.ts` + `src/routes/api/public/hooks/whatsapp-reminders.ts` refactor: replace per-clinic `clinic_settings.tunnel_url` lookup with a single read of `app_settings.whatsapp_tunnel_url`. Skip send + log when unset.

### Block 7 — Message payload rules

Rewrite `buildMessage` variants in `whatsapp.functions.ts`:
- **Message 1 (Confirmation)**: include patient name, `Dr. [Name] ([Specialty])`, `Date`, `Time`, `Full Clinic Address / Google Map Link` from `clinics.address`. **No token number**. Include tentative-time disclaimer.
- **All other messages** (reminder, doctor arrived, token update, delay update):
  - Always print Date + Time.
  - Include **Running Token Number** (current in-treatment token from today's queue for that doctor) and the patient's **Latest Dynamic Token** (recomputed chronological index).
  - Include standardized disclaimer: "All stated times are tentative appointment times and may shift with live queue movement."
  - Delay flow fans out immediately to all affected patients (respecting 7-msg cap + adaptive 3 token-update cap).

### Block 8 — Subscription/Trial + renewal reminder

- Trial default = **21 days** (schema default + `handle_new_user`).
- **Pricing calculator** utility (`src/lib/pricing.ts`): `monthlyFee = 499 * max(activeDoctorCount, 1)`. Displayed on a new **Billing** panel on the dashboard (read-only preview; no payment integration this pass unless requested).
- **Renewal cron** (see Block 1): daily 09:00, POSTs to `/api/public/hooks/renewal-reminders`. Handler inserts `platform_notifications` rows for clinics whose renewal is 7 days out (idempotent via unique `(clinic_id, kind, target_date)`).
- Dashboard header shows a **bell** with unread `platform_notifications` count + dropdown list.

### Block 9 — Feedback loop

- **Receptionist**: floating "Suggestions/Feedback" button on every `_authenticated` page → modal with single multi-line textarea → INSERT into `feedback`.
- **Super Admin**: `/_authenticated/admin/feedback` page — chronological list grouped by Clinic → user role → date, showing message text. Read-only.

### Technical notes

- One migration handles all schema (user_roles, app_settings, feedback, doctor_shift_status, platform_notifications, tokens unique index, clinic_settings.tunnel_url drop, trial 21d default, handle_new_user update, cron job + endpoints). Grants + RLS per project rules; `has_role` used for all admin gating.
- No stored token renumber trigger; display tokens computed in the client + in message payloads from the sorted list. Legacy `token_number` column retained for compatibility (nullable henceforth).
- Super Admin role must be granted manually to your account after the migration lands — I'll surface the exact `INSERT` for you to run via the data tool when the migration is approved.
- Existing `whatsapp-reminders` cron endpoint stays; its tunnel lookup switches to `app_settings`.
- No payment provider is enabled in this pass — pricing tier is display-only. If you want live billing (Stripe/Paddle), that's a separate follow-up.

Ready to proceed? On approval I'll ship the migration first, then Blocks 2→9 in code.
