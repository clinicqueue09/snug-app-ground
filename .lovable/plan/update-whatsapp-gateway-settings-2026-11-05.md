# Update WhatsApp gateway settings

## Changes
- Replace the current gateway address with `13.204.59.137` in both the `nip.io` hostname and raw-IP fallback.
- Send `x-gateway-key` on every `/connect`, `/status/:clinicId`, and `/send-message` request, while preserving existing request headers.
- Read `GATEWAY_API_KEY` only inside the relevant server-function handlers, pass it to the request helpers, and log/return a clear server-side error without contacting the gateway when it is missing.
- Limit changes to `src/lib/whatsapp.functions.ts`; leave all other behavior unchanged.

## Technical approach
- Update `gatewayFetch()` and `postToGateway()` to attach the supplied gateway key to their outgoing requests.
- Validate the key at server-function entry points that use those helpers, so secrets remain within server-only execution.
- Verify every gateway call path uses the new host and header, then check the build diagnostics.
