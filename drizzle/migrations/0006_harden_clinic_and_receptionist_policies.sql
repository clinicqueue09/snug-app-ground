DROP POLICY IF EXISTS "Enable insert for authenticated users creating a clinic" ON public.clinics;
DROP POLICY IF EXISTS "Users can only update their own receptionist record" ON public.receptionists;

CREATE OR REPLACE FUNCTION public.protect_clinic_billing_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'super_admin')
     AND (NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
          OR NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'Only super admins can modify trial or subscription status';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.protect_clinic_billing_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_clinic_billing_fields ON public.clinics;
CREATE TRIGGER protect_clinic_billing_fields BEFORE UPDATE ON public.clinics
FOR EACH ROW EXECUTE FUNCTION public.protect_clinic_billing_fields();