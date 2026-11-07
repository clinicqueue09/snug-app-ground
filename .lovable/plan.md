# WhatsApp clinic-number matching

Update only the WhatsApp linking and clinic profile flows described in the uploaded requirements.

## Changes
- Before requesting a QR code, have the authenticated server read the clinic's saved mobile number, take its last 10 digits, reject invalid values, and send the validated number as `expectedNumber`.
- Interpret gateway status errors as a number mismatch: never mark a mismatched WhatsApp connection as connected, and return a nullable mismatch message with every status result.
- Add an authenticated disconnect function that calls the gateway and clears the clinic's connected flag; use it from the setup card instead of browser-side database updates.
- Show gateway and status mismatch errors in the setup card, stop polling and hide the QR on mismatch, and disable Disconnect while it runs.
- When a saved clinic mobile changes while linked, clear the linked flag and show the requested relink notice.

## Technical details
- Preserve the existing gateway helper and its gateway-key header, authentication middleware, and already-connected handling.
- Keep the current app design components and limit changes to the WhatsApp server functions, setup card, and clinic profile save flow.
- Verify the updated code with the available build signal; do not call the external WhatsApp gateway as part of verification.