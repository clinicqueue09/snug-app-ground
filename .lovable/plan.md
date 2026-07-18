## Changes

**1. Fix `checkWhatsAppStatus` in `src/lib/whatsapp.functions.ts` (~L466-480)**
- URL: `GET ${GATEWAY_BASE}/status/${encodeURIComponent(data.clinicId)}` (path param).
- Connected check: `const connected = body?.isConnected === true;` (drop the old `status`/`connected` field checks).
- Rest of the handler (mirror `whatsapp_connected` in DB when connected, return shape) unchanged.

**2. Replace `src/assets/logo.png`**
- Copy `/mnt/user-uploads/image.png` to `src/assets/logo.png`, overwriting the existing generated logo. No edits, no regen.

**3. Remove tagline chip in `src/routes/_authenticated/dashboard.tsx`**
- Delete the `<span>` containing `ClinicQ · Calm queues, happier patients` near L289-291. Header keeps logo, clinic name, address, email.

## Verification
- Playwright: open `/dashboard`, click **Link WhatsApp**, screenshot the QR, then poll the DB / UI for ~10s to confirm the card flips to "Connected" after a scan — since scanning requires a real phone, verify instead that `checkWhatsAppStatus` is being called against `/status/<clinicId>` (network log) and returns without error, and that the polling loop is reading `isConnected`. Screenshot header to confirm tagline chip is gone and new logo renders.
