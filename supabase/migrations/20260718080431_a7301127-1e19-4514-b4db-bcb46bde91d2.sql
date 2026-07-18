
-- 1) reported_at on tokens
ALTER TABLE public.tokens ADD COLUMN IF NOT EXISTS reported_at TIMESTAMPTZ;

-- 2) protect subscription_rate on clinics
CREATE OR REPLACE FUNCTION public.protect_subscription_rate()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.subscription_rate IS DISTINCT FROM OLD.subscription_rate
     AND NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can modify subscription_rate';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clinics_protect_subscription_rate ON public.clinics;
CREATE TRIGGER clinics_protect_subscription_rate
BEFORE UPDATE ON public.clinics
FOR EACH ROW EXECUTE FUNCTION public.protect_subscription_rate();

-- 3) strict clinic_mobile validation in handle_new_user
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

  INSERT INTO public.clinics (name, address, clinic_mobile, avg_time_per_patient, trial_ends_at)
  VALUES (
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'clinic_name', ''), 'My Clinic'),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'clinic_address', ''), '—'),
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
