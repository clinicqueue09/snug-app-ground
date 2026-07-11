CREATE TABLE public.patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  email text,
  date_of_birth date,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.patients TO authenticated;
GRANT ALL ON public.patients TO service_role;

ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated staff can manage patients"
ON public.patients
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE TABLE public.doctors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  specialty text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.doctors TO authenticated;
GRANT ALL ON public.doctors TO service_role;

ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated staff can manage doctors"
ON public.doctors
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE TABLE public.queue_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id uuid REFERENCES public.doctors(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'in_progress', 'completed', 'no_show')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent', 'emergency')),
  notes text,
  check_in_time timestamp with time zone NOT NULL DEFAULT now(),
  start_time timestamp with time zone,
  end_time timestamp with time zone,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.queue_entries TO authenticated;
GRANT ALL ON public.queue_entries TO service_role;

ALTER TABLE public.queue_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated staff can manage queue entries"
ON public.queue_entries
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_patients_updated_at
BEFORE UPDATE ON public.patients
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_doctors_updated_at
BEFORE UPDATE ON public.doctors
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_queue_entries_updated_at
BEFORE UPDATE ON public.queue_entries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();