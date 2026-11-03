ALTER TABLE public.platform_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_secrets FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.platform_secrets TO service_role;
COMMENT ON TABLE public.platform_secrets IS 'Server-only secrets (e.g. cron_secret). RLS enabled, no policies, no anon/authenticated grants by design.';