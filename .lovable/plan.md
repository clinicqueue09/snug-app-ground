# Protect cron hooks with a dedicated CRON secret

## Goal
Both scheduled hooks (`/api/public/hooks/whatsapp-reminders` and `/api/public/hooks/renewal-reminders`) require an `X-Cron-Secret` header whose value matches a dedicated secret; a mismatch or missing header returns 401. The publishable key stops being an auth signal on `renewal-reminders`.

## Why not a Lovable env secret
The cron caller is `pg_cron` running **inside the database**. Lovable env secrets exist only in the function runtime — the database cannot read them, and generated secret values are never revealed, so they cannot be pasted into the cron SQL. A dedicated secret must therefore live where both sides can read it: a **locked table in the database**. This gives the same guarantee the user asked for (a secret no browser visitor can obtain), replacing the publishable-key check.

## Changes

### 1. Migration (lov_database--migration)
- `CREATE TABLE public.platform_secrets (name text PRIMARY KEY, value text NOT NULL, created_at timestamptz DEFAULT now())`
- `GRANT ALL ON public.platform_secrets TO service_role;` — no grants to `anon`/`authenticated`
- `ALTER TABLE public.platform_secrets ENABLE ROW LEVEL SECURITY` with **no policies** (fully locked through the Data API except service_role)
- Seed the secret in the same migration: `INSERT ... VALUES ('cron_secret', encode(extensions.gen_random_bytes(32),'hex')) ON CONFLICT DO NOTHING` — the value is minted inside SQL and never surfaced to anyone
- The cron jobs run as `postgres` (owner) and can read the table directly

### 2. Shared auth helper — `src/lib/cron-auth.ts`
`verifyCronSecret(request)`:
- Read `X-Cron-Secret` header; missing → false
- Fetch the `cron_secret` row via `supabaseAdmin` (privileged client, imported inside the helper)
- Constant-time compare with node `crypto.timingSafeEqual` (length-checked first)

### 3. Route handlers
- `renewal-reminders.ts`: delete the publishable-key / apikey check; call `verifyCronSecret(request)` → 401 JSON on failure
- `whatsapp-reminders.ts`: currently has **no auth at all** — add the same check at the top of the POST handler

### 4. Update both cron jobs (run_sql — contains the stable project URL, so not a migration)
`cron.unschedule` then `cron.schedule` for `whatsapp-24h-reminders` (every 15 min) and `renewal-reminders-daily` (09:00 UTC), same URLs and bodies as today, but the header is built dynamically so the secret never sits as a literal in the job definition:

```sql
headers := concat('{"Content-Type":"application/json","X-Cron-Secret":"',
  (SELECT value FROM public.platform_secrets WHERE name = 'cron_secret'), '"}')::jsonb
```

The `apikey` header is dropped from both jobs.

### 5. Record the decision
One rule in root `AGENTS.md`: cron hooks authenticate with the `X-Cron-Secret` header sourced from `public.platform_secrets` — never the publishable key.

## Verification
1. Typecheck/build passes (automatic).
2. Local: POST to both hooks with no header → 401; wrong header → 401; correct header (fetched from the DB inside the test script, never printed) → handler runs and returns its normal JSON.
3. Confirm both cron jobs show the new dynamic-header command (secret is not embedded in the SQL, so nothing sensitive is stored or printed).
4. Note: the existing jobs call the production URL (`project--...lovable.app`), which serves the published deployment — currently unpublished. URLs are left as-is; reminders will flow once the app is published.
