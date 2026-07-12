
-- 1) Restrictive-by-intent explicit deny policies on receptionists writes.
-- Writes were already denied (RLS enabled with no write policies), but add
-- explicit false-policies so any future permissive policy cannot silently
-- open self-assignment to arbitrary clinics.
CREATE POLICY "Deny receptionist inserts" ON public.receptionists
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "Deny receptionist updates" ON public.receptionists
  AS RESTRICTIVE FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "Deny receptionist deletes" ON public.receptionists
  AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

-- 2) Switch current_clinic_id() to SECURITY INVOKER. The receptionists
-- SELECT policy already lets the caller read their own row, so the
-- function still returns the correct clinic_id without needing DEFINER
-- privileges. Lock down EXECUTE to authenticated only.
CREATE OR REPLACE FUNCTION public.current_clinic_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT clinic_id FROM public.receptionists WHERE user_id = auth.uid()
$$;

REVOKE ALL ON FUNCTION public.current_clinic_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_clinic_id() TO authenticated, service_role;
