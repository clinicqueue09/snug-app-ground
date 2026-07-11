
-- Drop old tables
DROP TABLE IF EXISTS public.queue_entries CASCADE;
DROP TABLE IF EXISTS public.patients CASCADE;
DROP TABLE IF EXISTS public.doctors CASCADE;

-- Clinics
CREATE TABLE public.clinics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'My Clinic',
  status TEXT NOT NULL DEFAULT 'trial',
  trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '14 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinics TO authenticated;
GRANT ALL ON public.clinics TO service_role;
ALTER TABLE public.clinics ENABLE ROW LEVEL SECURITY;

-- Receptionists: link auth users to clinics
CREATE TABLE public.receptionists (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.receptionists TO authenticated;
GRANT ALL ON public.receptionists TO service_role;
ALTER TABLE public.receptionists ENABLE ROW LEVEL SECURITY;

-- Security definer: get user's clinic_id (avoid recursive RLS)
CREATE OR REPLACE FUNCTION public.current_clinic_id()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid()
$$;

CREATE POLICY "View own clinic" ON public.clinics FOR SELECT TO authenticated
  USING (id = public.current_clinic_id());
CREATE POLICY "Update own clinic" ON public.clinics FOR UPDATE TO authenticated
  USING (id = public.current_clinic_id()) WITH CHECK (id = public.current_clinic_id());

CREATE POLICY "View own receptionist row" ON public.receptionists FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Doctors (scoped per clinic)
CREATE TABLE public.doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  specialty TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.doctors TO authenticated;
GRANT ALL ON public.doctors TO service_role;
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinic doctors select" ON public.doctors FOR SELECT TO authenticated
  USING (clinic_id = public.current_clinic_id());
CREATE POLICY "Clinic doctors insert" ON public.doctors FOR INSERT TO authenticated
  WITH CHECK (clinic_id = public.current_clinic_id());
CREATE POLICY "Clinic doctors update" ON public.doctors FOR UPDATE TO authenticated
  USING (clinic_id = public.current_clinic_id()) WITH CHECK (clinic_id = public.current_clinic_id());
CREATE POLICY "Clinic doctors delete" ON public.doctors FOR DELETE TO authenticated
  USING (clinic_id = public.current_clinic_id());

-- Tokens (patient queue entries)
CREATE TABLE public.tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  token_number INT NOT NULL,
  patient_name TEXT NOT NULL,
  phone TEXT,
  doctor_id UUID REFERENCES public.doctors(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tokens TO authenticated;
GRANT ALL ON public.tokens TO service_role;
ALTER TABLE public.tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinic tokens select" ON public.tokens FOR SELECT TO authenticated
  USING (clinic_id = public.current_clinic_id());
CREATE POLICY "Clinic tokens insert" ON public.tokens FOR INSERT TO authenticated
  WITH CHECK (clinic_id = public.current_clinic_id());
CREATE POLICY "Clinic tokens update" ON public.tokens FOR UPDATE TO authenticated
  USING (clinic_id = public.current_clinic_id()) WITH CHECK (clinic_id = public.current_clinic_id());
CREATE POLICY "Clinic tokens delete" ON public.tokens FOR DELETE TO authenticated
  USING (clinic_id = public.current_clinic_id());

-- Auto-assign token_number per clinic per day
CREATE OR REPLACE FUNCTION public.assign_token_number()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.token_number IS NULL OR NEW.token_number = 0 THEN
    SELECT COALESCE(MAX(token_number), 0) + 1
      INTO NEW.token_number
      FROM public.tokens
      WHERE clinic_id = NEW.clinic_id
        AND created_at::date = CURRENT_DATE;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_assign_number BEFORE INSERT ON public.tokens
  FOR EACH ROW EXECUTE FUNCTION public.assign_token_number();

-- updated_at triggers
CREATE TRIGGER clinics_updated_at BEFORE UPDATE ON public.clinics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER doctors_updated_at BEFORE UPDATE ON public.doctors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER tokens_updated_at BEFORE UPDATE ON public.tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- On new user signup: create clinic + receptionist link
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_clinic_id UUID;
BEGIN
  INSERT INTO public.clinics (name) VALUES (COALESCE(NEW.raw_user_meta_data->>'clinic_name', 'My Clinic'))
    RETURNING id INTO new_clinic_id;
  INSERT INTO public.receptionists (user_id, clinic_id) VALUES (NEW.id, new_clinic_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.tokens;
