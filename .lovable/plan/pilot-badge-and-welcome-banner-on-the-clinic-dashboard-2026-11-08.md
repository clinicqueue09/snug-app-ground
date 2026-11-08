# Pilot badge and welcome banner on the clinic dashboard

## What clinics will see
1. **"Pilot" badge** — a small blue pill next to the ClinicQ logo in the top bar.
2. **Welcome banner** — a slim strip at the top of the dashboard:
   "Welcome to the ClinicQ Pilot. You have early access with full features. If anything looks unexpected, tap the Feedback button at the bottom right."
   - Has a close (X) button. Once closed, it stays hidden on that device/browser.
   - Patients' WhatsApp/SMS messages stay unchanged.

## Technical details
- Only `src/routes/_authenticated/dashboard.tsx` changes: badge added in the header beside the logo; banner rendered under the header.
- Dismissal saved in browser storage (`clinicq_pilot_banner_dismissed`), read in `useEffect` to avoid hydration mismatch.
- Uses existing blue theme tokens (`info` / `info-surface`), no new colours.
