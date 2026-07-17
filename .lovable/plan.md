# ClinicQ — Multi-tenant WhatsApp + UX updates

## 1. Database migration (`clinics`)
Add columns:
- `whatsapp_connected boolean NOT NULL DEFAULT false`
- `subscription_rate numeric(10,2) NOT NULL DEFAULT 0`

Backfill existing rows to defaults. No RLS changes (existing clinic policies already cover these columns). `subscription_rate` will be editable only by super_admin — enforced via a policy update so `authenticated` non-admins cannot update it (they keep update on the other fields).

## 2. Registration form (`src/routes/auth.tsx`)
- Rename label → **"Clinic Mobile (Whatsapp Number only)"** with required asterisk.
- Make field required: submit is blocked unless exactly 10 digits.
- Update `handle_new_user()` trigger to reject empty mobile (fallback to raising / storing NULL — but UI blocks empties; keep server tolerant).

## 3. Time slots → 10-minute intervals (`src/components/TimeSelect.tsx`)
Change `MINUTES` from `["00","15","30","45"]` → `["00","10","20","30","40","50"]`. All appointment pickers using `TimeSelect` inherit this.

## 4. Concurrent login
Supabase already issues independent sessions per device/token — no code change needed. Verify no custom "single-session" logic exists (grep confirms none). Documented as a no-op in the change log.

## 5. WhatsApp Setup UI + QR linking
New component `src/components/WhatsAppSetupCard.tsx` mounted on the dashboard (Settings area — collapsible card in header/toolbar).

- Install `react-qr-code` (`bun add react-qr-code`).
- "Link WhatsApp" button → server function `connectWhatsApp({ clinicId })` that POSTs to `http://15.207.87.63:3000/connect`.
  - Why server-side: preview is served over HTTPS; a browser `fetch` to `http://` is blocked as mixed content. All AWS gateway calls go through `createServerFn` handlers.
- Response `{ qr }` → render `<QRCode value={qr} />`.
- Response `{ status: "already_connected" }` → update `clinics.whatsapp_connected = true`, hide QR, show green "WhatsApp Connected" badge (via realtime/refetch).
- Poll same `/connect` every 4s while QR visible; stop on connect, unmount, or error. Cleanup on tab hide.
- Badge state driven by `clinics.whatsapp_connected` (live query).

## 6. Global send-message pipeline
- **Remove**: `clinic_settings.whatsapp_tunnel_url`, `app_settings.whatsapp_tunnel_url`, admin route `src/routes/_authenticated/admin/whatsapp.tsx`, admin nav link, `clinic_settings` table (obsolete), `getGlobalTunnelUrl()`, all localhost/ngrok/`Bypass-Tunnel-Reminder` logic.
- Rewrite `src/lib/whatsapp.functions.ts` `postToTunnel()` → `postToGateway(clinicId, phone10, message)` that POSTs to `http://15.207.87.63:3000/send-message` with `{ clinicId, phone: "91"+phone10, message }`.
- Gate every automated send: load `clinics.whatsapp_connected` first; if false, skip and return `{ ok:false, reason:"not_connected" }`.
- Update `src/routes/api/public/hooks/whatsapp-reminders.ts` and `renewal-reminders.ts` similarly (per-clinic gating).

## 7. "Patient Messaging" tab (warm-connect)
- New tab on dashboard: **Patient Messaging**.
- Fields: phone (10-digit) + fixed disabled preview of the exact message.
- Button **Send Initial Connect Message** → new server fn `sendWarmConnect({ phone })` (uses `requireSupabaseAuth`, resolves caller's `clinic_id`, checks `whatsapp_connected`, POSTs to `/send-message` with exact text: `"Hello! This is your clinic. We will be using this number to send your appointment updates and queue status. Please reply with 'ok' to confirm you have received this message."`).
- Toast success/error.

## Files touched
- Migration (columns + policy tweak + drop `clinic_settings` + drop `app_settings.whatsapp_tunnel_url`).
- `src/routes/auth.tsx` (label + required).
- `src/components/TimeSelect.tsx` (10-min).
- `src/lib/whatsapp.functions.ts` (rewrite gateway, add `connectWhatsApp`, `sendWarmConnect`).
- `src/components/WhatsAppSetupCard.tsx` (new).
- `src/routes/_authenticated/dashboard.tsx` (mount setup card + Patient Messaging tab + remove any WhatsApp-tunnel UI).
- `src/routes/api/public/hooks/whatsapp-reminders.ts` (use gateway + per-clinic gate).
- Delete `src/routes/_authenticated/admin/whatsapp.tsx` + admin nav entry.
- `bun add react-qr-code`.

## Notes / risks
- **Mixed content**: gateway is plain HTTP. All calls go through server functions; no browser → `http://…` fetch. If you later want browser-direct calls, the AWS host needs HTTPS (Caddy / ALB + ACM).
- **Auth**: gateway endpoints are unauthenticated per your spec — anyone with the URL + a clinicId could send. If that matters, add a shared secret header on the AWS side and store it as a Lovable Cloud secret; I can wire it up on request.
- Super-admin UI to edit `subscription_rate` per clinic isn't in your spec — column will exist, editable via SQL for now. Say the word and I'll add an admin screen.
