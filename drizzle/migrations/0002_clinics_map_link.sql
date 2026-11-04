-- 1) Separate Google Map location link column (nullable: existing clinics have no value yet)
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS map_link text;
COMMENT ON COLUMN public.clinics.map_link IS 'Google Maps location link, stored separately from address';

-- 2) Backfill: copy the first http(s) URL found in address into map_link; leave null otherwise
UPDATE public.clinics
SET map_link = rtrim(rtrim(substring(address from 'https?://[^[:space:]]+'), '.'), ',')
WHERE map_link IS NULL AND address ~ 'https?://';

-- 3) handle_new_user: read clinic_map_link from signup metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_clinic_id UUID;
  meta_mobile TEXT;
BEGIN
  meta_mobile := NULLIF(NEW.raw_user_meta_data->>'clinic_mobile', '');
  IF meta_mobile IS NOT NULL AND meta_mobile !~ '^[0-9]{10}$' THEN
    RAISE EXCEPTION 'clinic_mobile must be exactly 10 digits';
  END IF;

  INSERT INTO public.clinics (name, address, map_link, clinic_mobile, avg_time_per_patient, trial_ends_at)
  VALUES (
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'clinic_name', ''), 'My Clinic'),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'clinic_address', ''), '—'),
    NULLIF(NEW.raw_user_meta_data->>'clinic_map_link', ''),
    meta_mobile,
    10,
    now() + interval '21 days'
  )
  RETURNING id INTO new_clinic_id;

  INSERT INTO public.receptionists (user_id, clinic_id)
  VALUES (NEW.id, new_clinic_id);

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'receptionist')
    ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;