
## 1. Logo replacement
- Copy the attached `user-uploads://ClinicQ_Logo.png` over `src/assets/logo.png` as-is (no regeneration, no edits). Dashboard already imports it, so no code changes needed.

## 2. Remove Warm Connection entirely
- `src/routes/_authenticated/dashboard.tsx`: remove `WarmConnectCard` import and its `<WarmConnectCard />` render (~line 355) and its column wrapper if it leaves an empty grid cell.
- `src/components/WhatsAppSetupCard.tsx`: delete the `WarmConnectCard` export (keep `WhatsAppSetupCard`).
- `src/lib/whatsapp.functions.ts`: remove `sendWarmConnectMessage` server fn and any helpers only it used.
- Search the repo for `WarmConnect` / `sendWarmConnectMessage` and remove any leftover references.

## 3. Schema — per-phone opt-in
New migration:
```sql
CREATE TABLE public.whatsapp_optins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  opted_in_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, phone_number)
);
GRANT SELECT ON public.whatsapp_optins TO authenticated;
GRANT ALL ON public.whatsapp_optins TO service_role;
ALTER TABLE public.whatsapp_optins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clinic reads own optins" ON public.whatsapp_optins
  FOR SELECT TO authenticated USING (clinic_id = public.current_clinic_id());
-- writes only via service_role (webhook + dispatcher)
CREATE INDEX ON public.whatsapp_optins (clinic_id, phone_number);
```
Opt-in is keyed on `(clinic_id, phone_number)` so a returning patient stays opted in across visits.

## 4. Fast2SMS server function
- Add `src/lib/sms.functions.ts` with `sendSms({ phone, message })` using `createServerFn` (TanStack Start server fn, not a Deno Edge Function — the codebase has no Deno runtime). Reads `process.env.FAST2SMS_API_KEY` inside the handler.
- Route = **Quick SMS (`q`)** per your answer. Call:
  ```
  POST https://www.fast2sms.com/dev/bulkV2
  headers: { authorization: <key>, 'Content-Type': 'application/x-www-form-urlencoded' }
  body: route=q&message=<msg>&language=english&numbers=<10digit>
  ```
- Returns `{ ok, providerId?, error? }`; log failures server-side.

## 5. Central dispatcher `notifyPatient`
- In `src/lib/whatsapp.functions.ts` add `notifyPatient({ tokenId, messageType })` server fn (auth-gated). Message types: `confirmation`, `reported`, `queue_update`, `next`, `doctor_arrived`.
- Flow:
  1. Load token + clinic + doctor via `supabaseAdmin` (imported inside handler).
  2. Look up `whatsapp_optins` for `(clinic_id, phone_number)`.
  3. If opted-in AND `clinic.whatsapp_connected` → build via existing `buildMessage(type, …)` + `postToGateway`.
  4. Else → build SMS text (short form) and call `sendSms`.
  5. For `confirmation` when not opted-in, use the **new SMS template**:
     ```
     Hello {patientName}, your appointment at {clinicName} with {doc} is confirmed.
     Date: {date} | Time: {time}
     Please click the WhatsApp link below and send "Hi" to get further updates on appointment time, token number, as well as clinic location Google map link:
     https://wa.me/91{clinicWhatsAppNumber}?text=Hi
     — Powered by ClinicQ
     ```
     (`clinicWhatsAppNumber` = `clinics.clinic_mobile`; no map link, no address.)
  6. Increment `whatsapp_messages_sent` / set relevant `*_sent_at` columns just like today.
- Refactor the 5 existing call sites in `dashboard.tsx` (confirmation on add, reported, queue-position bumps, "you're next", doctor arrived) to call `notifyPatient` instead of `sendWhatsApp*` directly. Existing `postToGateway` + `buildMessage` stay for the WhatsApp branch.

## 6. Opt-in webhook route
- New file `src/routes/api/public/hooks/whatsapp-optin.ts`.
- `POST { clinicId: uuid, phone: string }` (accepts 10-digit or `91XXXXXXXXXX`; normalizes to 10 digits).
- Verifies `X-Webhook-Secret` header against `process.env.WHATSAPP_OPTIN_SECRET` using `timingSafeEqual`.
- On match: `supabaseAdmin.from('whatsapp_optins').upsert({ clinic_id, phone_number }, { onConflict: 'clinic_id,phone_number' })`.
- Returns `{ ok: true }` or 401 / 400.
- Secret creation: use `secrets--generate_secret` to mint `WHATSAPP_OPTIN_SECRET` (random 48 chars). Since AWS also needs the value, I'll use `secrets--update_secret` instead to open the secure form so you can set + copy the value yourself (generated secrets are never revealed).
- After build, I'll give you:
  - Route URL: `https://project--633d8826-8148-4013-bfd0-a44ea5623e55.lovable.app/api/public/hooks/whatsapp-optin` (published) and the `-dev` variant for preview.
  - The secret value (whatever you enter in the secure form) — configure both on the AWS gateway.

## Technical notes
- `Deno.env.get` doesn't exist in this stack — TanStack Start runs on a Cloudflare Worker via `process.env`. The Fast2SMS secret is already stored (`FAST2SMS_API_KEY`) and is read inside the handler.
- All new server fns use `requireSupabaseAuth` except the webhook route (public, secret-gated).
- Realtime dashboard subscription on `tokens` already picks up `whatsapp_messages_sent` updates — no UI changes needed for the send indicators.

## Files touched
- migration: `whatsapp_optins` table + policies
- new: `src/lib/sms.functions.ts`, `src/routes/api/public/hooks/whatsapp-optin.ts`
- edit: `src/lib/whatsapp.functions.ts` (remove warm connect, add `notifyPatient`), `src/components/WhatsAppSetupCard.tsx` (drop `WarmConnectCard`), `src/routes/_authenticated/dashboard.tsx` (remove card, route sends through `notifyPatient`)
- asset: overwrite `src/assets/logo.png` with the uploaded file
