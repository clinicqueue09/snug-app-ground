
-- 1) Add columns to tokens
ALTER TABLE public.tokens
  ADD COLUMN IF NOT EXISTS appointment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS appointment_time TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_sent_at TIMESTAMPTZ;

-- Backfill appointment_date from created_at for any existing rows
UPDATE public.tokens SET appointment_date = created_at::date WHERE appointment_date IS NULL;

-- 2) Rewrite token numbering: per (clinic_id, doctor_id, appointment_date)
CREATE OR REPLACE FUNCTION public.assign_token_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.token_number IS NULL OR NEW.token_number = 0 THEN
    SELECT COALESCE(MAX(token_number), 0) + 1
      INTO NEW.token_number
      FROM public.tokens
      WHERE clinic_id = NEW.clinic_id
        AND appointment_date = NEW.appointment_date
        AND doctor_id IS NOT DISTINCT FROM NEW.doctor_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Ensure trigger exists
DROP TRIGGER IF EXISTS assign_token_number_trigger ON public.tokens;
CREATE TRIGGER assign_token_number_trigger
  BEFORE INSERT ON public.tokens
  FOR EACH ROW EXECUTE FUNCTION public.assign_token_number();

-- 3) clinic_settings table
CREATE TABLE IF NOT EXISTS public.clinic_settings (
  clinic_id UUID PRIMARY KEY REFERENCES public.clinics(id) ON DELETE CASCADE,
  tunnel_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinic_settings TO authenticated;
GRANT ALL ON public.clinic_settings TO service_role;

ALTER TABLE public.clinic_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Receptionists can view their clinic settings"
  ON public.clinic_settings FOR SELECT
  USING (clinic_id IN (SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid()));

CREATE POLICY "Receptionists can insert their clinic settings"
  ON public.clinic_settings FOR INSERT
  WITH CHECK (clinic_id IN (SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid()));

CREATE POLICY "Receptionists can update their clinic settings"
  ON public.clinic_settings FOR UPDATE
  USING (clinic_id IN (SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid()));

CREATE TRIGGER update_clinic_settings_updated_at
  BEFORE UPDATE ON public.clinic_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
