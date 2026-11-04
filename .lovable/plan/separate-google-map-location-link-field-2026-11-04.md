# Separate Google Map location link field

The clinic address and the Google Maps link are one combined field today (signup, clinic profile, and message templates). This splits them into two mandatory fields with validation, and routes the map link through messages as its own line.

## 1. Database (migration)

- Add a nullable `map_link text` column to `clinics` (NOT NULL on purpose: existing clinics have no value yet).
- Backfill: for existing clinics, copy the first `http(s)://…` URL found inside `address` into `map_link`; leave `map_link` null where the address has no URL. The address itself is left untouched.
- Update `handle_new_user()` to read `clinic_map_link` from the signup metadata and store it in `clinics.map_link`.

## 2. Sign-up form (`src/routes/auth.tsx`)

- Replace the single combined field with two required fields:
  - "Clinic Address", placeholder "123 Main St, City".
  - "Google Map Location Link", placeholder "https://maps.app.goo.gl/…".
- Validation on the map link: must start with `https://` and be a Google Maps link (`google.com/maps`, `maps.app.goo.gl`, or `goo.gl/maps`). Error text: "Please paste a valid Google Maps location link."
- Send both values in the signup metadata as `clinic_address` and `clinic_map_link`.
- Remove the "Full Clinic Address / Google Map Link" label and any "/" wording.

## 3. Clinic settings dialog (`dashboard.tsx`, ClinicProfileDialog)

- Same two fields, same labels, same placeholders, same validation as sign-up.
- Saving writes `address` and `map_link` separately.
- While the clinic has no saved map link, the dialog shows a banner: "Add your Google Map location link".
- The map-link field is required on save, so existing clinics get prompted to add it.

## 4. Messages (`src/lib/whatsapp.functions.ts`)

- `buildMessage()` takes `clinicMapLink` alongside `clinicAddress`. The combined "Full Clinic Address / Google Map Link: …" line becomes two separate lines:
  - `Clinic Address: <address>. Contact: <mobile>.`
  - `Location: <map_link>` (omitted when the clinic has no map link yet).
- All three call sites (dispatcher, doctor-arrived batch, WhatsApp reminders path) fetch `map_link` from the clinic and pass it through.
- First confirmation SMS: unchanged except that the "Location:" line now comes from the new `map_link` field (no longer scraped from the address), and the opt-in wording changes to: To receive further updates on appointment progress, click the link below and send "Hi" on WhatsApp (spelling of "appointment" corrected).
- Later SMS/WhatsApp messages use the new two-line address + location format.

## Verification

- Apply the migration, confirm backfilled rows, regenerate types.
- Typecheck + build.
- Preview: sign-up form validation, settings dialog banner + save, and a seeded clinic without a map link shows no Location line while one with a link shows both lines.
