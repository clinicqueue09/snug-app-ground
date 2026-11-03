-- Locked secret store for server-to-server cron authentication.
-- Readable only by service_role via the Data API (no anon/authenticated grants, no policies);
-- postgres (pg_cron jobs) reads it directly as the table owner.
CREATE TABLE public.platform_secrets (
  name text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.platform_secrets TO service_role;

ALTER TABLE public.platform_secrets ENABLE ROW LEVEL SECURITY;

-- Mint the cron secret inside SQL so its value is never surfaced to anyone.
INSERT INTO public.platform_secrets (name, value)
VALUES ('cron_secret', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;