## Scope
Ten changes across frontend, one migration, and shared WhatsApp helper. Grouped for efficient implementation.

## 1. Backend wiring (already live)

**1a. QR polling fix**
- `src/lib/whatsapp.functions.ts`: add `checkWhatsAppStatus` server fn hitting `GET ${GATEWAY_BASE}/status/:clinicId`.
- `src/components/WhatsAppSetupCard.tsx`: `startLink()` calls `/connect` once; the 3s `setInterval` calls `checkWhatsAppStatus` instead. On `status === "connected"` (or `already_connected`), stop polling, mirror `whatsapp_connected=true`, toast success. If a new QR string appears in the status body, update `qr`.

**1b. Migration**
- Create `public.protect_subscription_rate()` + BEFORE UPDATE trigger on `public.clinics` blocking non-super_admin changes.
- Replace `public.handle_new_user()` so an invalid `clinic_mobile` format raises `clinic_mobile must be exactly 10 digits` instead of nulling silently.

## 2. New features

**3. Past-date/time block**
- In the token creation dialog inside `src/routes/_authenticated/dashboard.tsx`, before insert combine `appointment_date + appointment_time` and compare against `new Date()`. If past → set inline error near the date/time fields, block submit, no toast-only.

**4. History view (30 days)**
- Add a date-range selector to the dashboard queue tabs: default = today; allow the user to pick any date in the last 30 days (simple date input with `min = today-30d`, `max = today`). Query filters `appointment_date` accordingly. Realtime subscription stays scoped to selected date.

**5. Logo + tagline**
- Add `<img src="/logo.png">` to dashboard header (public/logo.png supplied by user) with tagline text next to clinic name.

**6. Color theme (styles.css)**
- Update `:root` tokens to a light, low-eye-strain palette: soft off-white background (~oklch 0.99), near-black foreground, teal/emerald primary accent, warm amber for warnings, muted rose for destructive. Keep all contrast ratios ≥ WCAG AA on background. Dark mode kept but re-tuned proportionally.

**7. Concise patient rows**
- Tighten row padding (`py-1.5`), reduce font sizes, drop repeated labels ("Token:", "Phone:"), rely on column headers. On mobile collapse to two-line card: line 1 = `#token · name · status pill`, line 2 = `time · phone · actions`. Fewer icons, `text-xs` where safe.

**8. Reported status**
- Migration: add `reported_at timestamptz` to `tokens` + GRANT already covered.
- Dashboard: add "Mark Reported" action per row (sets `reported_at = now()`), and an unset toggle. Reported patients render their name in a distinct accent color (e.g. emerald-600) plus a small "Reported" chip. Sorting unchanged.

**9. WhatsApp signature**
- Refactor `postToGateway` into a shared helper `src/lib/whatsapp-gateway.ts` exporting `sendGatewayMessage(clinicId, phone10, message)` that appends `\n\n✨ *Powered by ClinicQ* ✨` to every message before POSTing.
- Both `src/lib/whatsapp.functions.ts` and `src/routes/api/public/hooks/whatsapp-reminders.ts` import & use it; remove their local copies.

**10. Feedback button**
- In `dashboard.tsx` `FeedbackTray`, convert the fixed pill to `h-12 w-12 rounded-full` with only `MessageCircle` icon; wrap in shadcn `Tooltip` showing "Suggestions / Feedback". Keep `fixed bottom-6 right-6 z-40`. Verify no overlap with row action buttons by adding `pb-24` (or equivalent) to the table container on small screens.

## Technical notes
- No changes to auto-generated Supabase files.
- Migration order: (1b) trigger + handle_new_user, plus (8) `reported_at` column — single migration.
- Shared helper lives outside `src/server/` so it can be imported by both a `.functions.ts` and a route file safely (pure fetch wrapper, no server-only imports).
- Realtime channel filter updates when selected date changes (unsubscribe + resubscribe).

## Out of scope
- Redesigning auth pages, admin routes, or WhatsApp template wording beyond appending the signature.
- Changing the AWS gateway contract.
