CREATE TABLE public.whatsapp_optins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  opted_in_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, phone_number)
);
GRANT SELECT ON public.whatsapp_optins TO authenticated;
GRANT ALL ON public.whatsapp_optins TO service_role;
ALTER TABLE public.whatsapp_optins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clinic reads own optins" ON public.whatsapp_optins
  FOR SELECT TO authenticated USING (clinic_id = public.current_clinic_id());
CREATE INDEX whatsapp_optins_clinic_phone_idx ON public.whatsapp_optins (clinic_id, phone_number);