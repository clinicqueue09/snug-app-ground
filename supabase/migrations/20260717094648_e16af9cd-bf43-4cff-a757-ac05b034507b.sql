
-- Add columns
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS whatsapp_connected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS subscription_rate numeric(10,2) NOT NULL DEFAULT 0;

-- Drop obsolete tunnel URL & clinic_settings
ALTER TABLE public.app_settings DROP COLUMN IF EXISTS whatsapp_tunnel_url;
DROP TABLE IF EXISTS public.clinic_settings CASCADE;
