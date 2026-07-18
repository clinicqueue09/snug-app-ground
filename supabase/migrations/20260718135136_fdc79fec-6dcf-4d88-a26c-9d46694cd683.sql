GRANT SELECT ON public.whatsapp_optins TO authenticated;
GRANT ALL ON public.whatsapp_optins TO service_role;
ALTER TABLE public.whatsapp_optins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Receptionists read own clinic optins" ON public.whatsapp_optins;
CREATE POLICY "Receptionists read own clinic optins"
  ON public.whatsapp_optins FOR SELECT
  TO authenticated
  USING (clinic_id = public.current_clinic_id());