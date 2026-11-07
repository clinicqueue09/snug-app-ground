-- Doctor working hours (sessions) and days off, used by the visual slot picker
-- and the Schedule tab.
-- weekday: 0 = Sunday ... 6 = Saturday (same numbering as JavaScript getDay()).
-- Times are stored as zero-padded "HH:MM" text, matching tokens.appointment_time.

CREATE TABLE IF NOT EXISTS public.doctor_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time text NOT NULL CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time text NOT NULL CHECK (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.doctor_availability TO authenticated;
GRANT ALL ON public.doctor_availability TO service_role;
ALTER TABLE public.doctor_availability ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS doctor_availability_doctor_idx
  ON public.doctor_availability (doctor_id, weekday);

CREATE TABLE IF NOT EXISTS public.doctor_time_off (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  off_date date NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doctor_id, off_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.doctor_time_off TO authenticated;
GRANT ALL ON public.doctor_time_off TO service_role;
ALTER TABLE public.doctor_time_off ENABLE ROW LEVEL SECURITY;

-- A clinic's staff can read and manage only their own clinic's rows, and only
-- for doctors that belong to that same clinic.
CREATE POLICY "Clinic availability select" ON public.doctor_availability FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid()));
CREATE POLICY "Clinic availability insert" ON public.doctor_availability FOR INSERT TO authenticated
  WITH CHECK (
    clinic_id IN (SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.doctors d WHERE d.id = doctor_availability.doctor_id AND d.clinic_id = doctor_availability.clinic_id)
  );
CREATE POLICY "Clinic availability update" ON public.doctor_availability FOR UPDATE TO authenticated
  USING (clinic_id IN (SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid()))
  WITH CHECK (
    clinic_id IN (SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.doctors d WHERE d.id = doctor_availability.doctor_id AND d.clinic_id = doctor_availability.clinic_id)
  );
CREATE POLICY "Clinic availability delete" ON public.doctor_availability FOR DELETE TO authenticated
  USING (clinic_id IN (SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid()));

CREATE POLICY "Clinic time off select" ON public.doctor_time_off FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid()));
CREATE POLICY "Clinic time off insert" ON public.doctor_time_off FOR INSERT TO authenticated
  WITH CHECK (
    clinic_id IN (SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.doctors d WHERE d.id = doctor_time_off.doctor_id AND d.clinic_id = doctor_time_off.clinic_id)
  );
CREATE POLICY "Clinic time off update" ON public.doctor_time_off FOR UPDATE TO authenticated
  USING (clinic_id IN (SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid()))
  WITH CHECK (
    clinic_id IN (SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.doctors d WHERE d.id = doctor_time_off.doctor_id AND d.clinic_id = doctor_time_off.clinic_id)
  );
CREATE POLICY "Clinic time off delete" ON public.doctor_time_off FOR DELETE TO authenticated
  USING (clinic_id IN (SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid()));