DROP POLICY IF EXISTS "allow_all_clinics_read" ON public.app_settings;
REVOKE ALL ON public.app_settings FROM anon, authenticated;
GRANT ALL ON public.app_settings TO service_role;