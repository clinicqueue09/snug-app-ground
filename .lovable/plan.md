## Clinic Dashboard: Advance Bookings, Doctor Queues & WhatsApp Integration

Rolling out in 5 blocks. Each block is self-contained and testable.

---

### Block 1 — Schema: appointment date/time + per-doctor daily tokens

Migration on `tokens`:
- Add `appointment_date DATE NOT NULL DEFAULT CURRENT_DATE`
- Add `appointment_time TEXT` (stores `HH:MM`, simpler than TIME for the form)
- Add `whatsapp_sent_at TIMESTAMPTZ` (so we don't spam on updates)
- New table `clinic_settings(clinic_id PK, tunnel_url TEXT, updated_at)` + RLS + GRANTs for the WhatsApp tunnel URL
- Rewrite `assign_token_number()` trigger: number resets per `(clinic_id, doctor_id, appointment_date)` instead of per clinic per day
- Backfill existing rows: `appointment_date := created_at::date`

### Block 2 — Add Patient form upgrades

In `AddPatientCard`:
- Date picker (shadcn Calendar in Popover), defaults to today, `disabled={date < today}`
- Time picker: native `<input type="time">` (works well on iPad)
- Phone: mandatory, `pattern ^[0-9]{10}$`, inline red helper text under the field, submit blocked until valid
- Insert now includes `appointment_date` + `appointment_time`

### Block 3 — Queue filtering, doctor tabs, Upcoming view

- Top-level Tabs: **Today's Queue** | **Upcoming Appointments**
- Today's Queue query: `.eq('appointment_date', todayISO)` (replaces the `gte(created_at, today)` filter — this is the midnight reset)
- Upcoming query: `.gt('appointment_date', todayISO)` grouped by date
- Inside Today's Queue: doctor filter chips (All + one per active doctor); client-side filter on already-loaded rows
- Token cell shows `#N` scoped per doctor (already correct after Block 1)

### Block 4 — Reschedule action

- New "Reschedule" ghost button on every row (all statuses)
- Opens Dialog with date picker + time input prefilled from row
- On save: `update({ appointment_date, appointment_time })` — token number is preserved (rescheduling doesn't renumber; documented tradeoff, matches "don't delete historical data" intent)

### Block 5 — WhatsApp tunnel integration

UI:
- New "WhatsApp Settings" dialog (gear icon in header) — input for `tunnel_url`, saved to `clinic_settings`
- Small status pill in header: "WhatsApp: configured / not configured"

Server:
- New TanStack server function `sendWhatsAppMessage` (`src/lib/whatsapp.functions.ts`) using `requireSupabaseAuth`
  - Loads `tunnel_url` for caller's clinic
  - Builds payload: `{ phone: "91" + phone, message: "Hello {name}, your appointment with Dr. {doctor} is confirmed for {date} at {time}. Your Token is {token}." }`
  - POSTs to `${tunnel_url}/send-message` with headers `Content-Type: application/json` and `Bypass-Tunnel-Reminder: true`
  - Returns `{ ok, status }`; failures are toast-warned, not fatal (add-patient still succeeds)

Trigger points (client-side, after successful DB write):
- After `Add to Queue` succeeds → fire confirmation message
- After clicking a new **"Next in Line"** button on a waiting row (sends "your turn is coming up" — same payload shape, message text noted as the "Next in Line" variant)

Not using an Edge Function: TanStack `createServerFn` is the standard for app-internal calls in this stack.

---

### Technical notes

- All migrations follow the CREATE TABLE → GRANT → RLS → POLICY order for `clinic_settings`.
- The token-number trigger change is backward-compatible: existing rows keep their numbers; new inserts use the new per-doctor-per-date sequence.
- `appointment_time` stored as `TEXT` (`HH:MM`) to sidestep timezone quirks with `TIME` and to round-trip cleanly with `<input type="time">`.
- WhatsApp call runs server-side (not from the browser) so the tunnel URL isn't exposed and CORS isn't a concern.
- The current `/auth` hydration warning is unrelated to this work; I'll leave it alone unless you want it fixed in the same pass.

Ready to build?
