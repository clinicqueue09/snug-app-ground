
-- Schema alignment
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS address text;

ALTER TABLE public.receptionists ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.receptionists ADD COLUMN IF NOT EXISTS name text;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'receptionists_pkey'
  ) THEN
    ALTER TABLE public.receptionists ADD CONSTRAINT receptionists_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tokens' AND column_name='phone')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tokens' AND column_name='phone_number') THEN
    ALTER TABLE public.tokens RENAME COLUMN phone TO phone_number;
  END IF;
END $$;

-- Drop existing policies to replace with the requested set
DROP POLICY IF EXISTS "View own clinic" ON public.clinics;
DROP POLICY IF EXISTS "Update own clinic" ON public.clinics;
DROP POLICY IF EXISTS "View own clinic details" ON public.clinics;
DROP POLICY IF EXISTS "Enable insert for authenticated users creating a clinic" ON public.clinics;
DROP POLICY IF EXISTS "Receptionists can only update their own clinic" ON public.clinics;

DROP POLICY IF EXISTS "View own receptionist row" ON public.receptionists;
DROP POLICY IF EXISTS "Deny receptionist inserts" ON public.receptionists;
DROP POLICY IF EXISTS "Deny receptionist updates" ON public.receptionists;
DROP POLICY IF EXISTS "Deny receptionist deletes" ON public.receptionists;
DROP POLICY IF EXISTS "Enable insert for receptionist account creation" ON public.receptionists;
DROP POLICY IF EXISTS "View own receptionist record" ON public.receptionists;
DROP POLICY IF EXISTS "Users can only update their own receptionist record" ON public.receptionists;

DROP POLICY IF EXISTS "Clinic doctors select" ON public.doctors;
DROP POLICY IF EXISTS "Clinic doctors insert" ON public.doctors;
DROP POLICY IF EXISTS "Clinic doctors update" ON public.doctors;
DROP POLICY IF EXISTS "Clinic doctors delete" ON public.doctors;
DROP POLICY IF EXISTS "View own clinic doctors" ON public.doctors;
DROP POLICY IF EXISTS "Enable insert for adding doctors" ON public.doctors;

DROP POLICY IF EXISTS "Clinic tokens select" ON public.tokens;
DROP POLICY IF EXISTS "Clinic tokens insert" ON public.tokens;
DROP POLICY IF EXISTS "Clinic tokens update" ON public.tokens;
DROP POLICY IF EXISTS "Clinic tokens delete" ON public.tokens;
DROP POLICY IF EXISTS "View own clinic tokens" ON public.tokens;
DROP POLICY IF EXISTS "Update own clinic tokens" ON public.tokens;
DROP POLICY IF EXISTS "Add tokens if active or in trial" ON public.tokens;

-- Grants (ensure Data API access)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinics TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.doctors TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.receptionists TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tokens TO authenticated;
GRANT ALL ON public.clinics, public.doctors, public.receptionists, public.tokens TO service_role;

-- CLINIC POLICIES
CREATE POLICY "View own clinic details" ON public.clinics FOR SELECT
USING (id IN (SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid()));

CREATE POLICY "Enable insert for authenticated users creating a clinic" ON public.clinics FOR INSERT
TO authenticated WITH CHECK (true);

CREATE POLICY "Receptionists can only update their own clinic" ON public.clinics FOR UPDATE
TO authenticated USING (id IN (SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid()))
WITH CHECK (id IN (SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid()));

-- RECEPTIONIST POLICIES
CREATE POLICY "Enable insert for receptionist account creation" ON public.receptionists FOR INSERT
TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "View own receptionist record" ON public.receptionists FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can only update their own receptionist record" ON public.receptionists FOR UPDATE
TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- DOCTOR POLICIES
CREATE POLICY "View own clinic doctors" ON public.doctors FOR SELECT
USING (clinic_id IN (SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid()));

CREATE POLICY "Enable insert for adding doctors" ON public.doctors FOR INSERT
TO authenticated WITH CHECK (clinic_id IN (SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid()));

CREATE POLICY "Update own clinic doctors" ON public.doctors FOR UPDATE
TO authenticated USING (clinic_id IN (SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid()))
WITH CHECK (clinic_id IN (SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid()));

-- TOKEN POLICIES
CREATE POLICY "View own clinic tokens" ON public.tokens FOR SELECT
USING (clinic_id IN (SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid()));

CREATE POLICY "Update own clinic tokens" ON public.tokens FOR UPDATE
USING (clinic_id IN (SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid()));

CREATE POLICY "Add tokens if active or in trial" ON public.tokens FOR INSERT
WITH CHECK (
  clinic_id IN (SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.clinics
    WHERE id = tokens.clinic_id
    AND (status = 'active' OR trial_ends_at > now())
  )
);
