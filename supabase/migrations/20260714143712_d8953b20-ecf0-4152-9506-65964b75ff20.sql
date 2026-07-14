
-- Block 1: schema updates

-- Backfill clinics before NOT NULL
UPDATE public.clinics SET name = 'My Clinic' WHERE name IS NULL OR name = '';
UPDATE public.clinics SET address = '—' WHERE address IS NULL OR address = '';

ALTER TABLE public.clinics
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN address SET NOT NULL,
  ADD COLUMN IF NOT EXISTS clinic_mobile TEXT,
  ADD COLUMN IF NOT EXISTS avg_time_per_patient INT NOT NULL DEFAULT 10;

ALTER TABLE public.clinics
  DROP CONSTRAINT IF EXISTS clinics_mobile_format_chk;
ALTER TABLE public.clinics
  ADD CONSTRAINT clinics_mobile_format_chk
  CHECK (clinic_mobile IS NULL OR clinic_mobile ~ '^[0-9]{10}$');

ALTER TABLE public.clinics
  DROP CONSTRAINT IF EXISTS clinics_avg_time_positive_chk;
ALTER TABLE public.clinics
  ADD CONSTRAINT clinics_avg_time_positive_chk
  CHECK (avg_time_per_patient > 0 AND avg_time_per_patient <= 240);

-- Backfill tokens
UPDATE public.tokens SET phone_number = '0000000000' WHERE phone_number IS NULL OR phone_number !~ '^[0-9]{10}$';

ALTER TABLE public.tokens
  ALTER COLUMN patient_name SET NOT NULL,
  ALTER COLUMN phone_number SET NOT NULL,
  ADD COLUMN IF NOT EXISTS whatsapp_messages_sent INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reminder_24h_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS doctor_arrived_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_position_notified INT,
  ADD COLUMN IF NOT EXISTS token_update_count INT NOT NULL DEFAULT 0;

ALTER TABLE public.tokens
  DROP CONSTRAINT IF EXISTS tokens_phone_format_chk;
ALTER TABLE public.tokens
  ADD CONSTRAINT tokens_phone_format_chk
  CHECK (phone_number ~ '^[0-9]{10}$');

-- Rewrite handle_new_user to accept the new signup metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_clinic_id UUID;
  meta_mobile TEXT;
  meta_avg INT;
BEGIN
  meta_mobile := NULLIF(NEW.raw_user_meta_data->>'clinic_mobile', '');
  IF meta_mobile IS NOT NULL AND meta_mobile !~ '^[0-9]{10}$' THEN
    meta_mobile := NULL;
  END IF;

  BEGIN
    meta_avg := GREATEST(1, LEAST(240, (NEW.raw_user_meta_data->>'avg_time_per_patient')::int));
  EXCEPTION WHEN others THEN
    meta_avg := 10;
  END;

  INSERT INTO public.clinics (name, address, clinic_mobile, avg_time_per_patient)
  VALUES (
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'clinic_name', ''), 'My Clinic'),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'clinic_address', ''), '—'),
    meta_mobile,
    COALESCE(meta_avg, 10)
  )
  RETURNING id INTO new_clinic_id;

  INSERT INTO public.receptionists (user_id, clinic_id)
  VALUES (NEW.id, new_clinic_id);

  RETURN NEW;
END;
$$;
