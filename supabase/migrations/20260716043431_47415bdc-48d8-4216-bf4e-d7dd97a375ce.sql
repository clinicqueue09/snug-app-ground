
-- Roles
CREATE TYPE public.app_role AS ENUM ('super_admin', 'receptionist');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
REVOKE ALL ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, service_role;

-- App settings
CREATE TABLE public.app_settings (
  id TEXT PRIMARY KEY DEFAULT 'global',
  whatsapp_tunnel_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (id = 'global')
);
GRANT SELECT, INSERT, UPDATE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super admin reads app_settings" ON public.app_settings FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "super admin writes app_settings" ON public.app_settings FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "super admin updates app_settings" ON public.app_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'super_admin')) WITH CHECK (public.has_role(auth.uid(), 'super_admin'));
INSERT INTO public.app_settings (id) VALUES ('global') ON CONFLICT DO NOTHING;

-- Feedback
CREATE TABLE public.feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID REFERENCES public.clinics(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_role TEXT,
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.feedback TO authenticated;
GRANT ALL ON public.feedback TO service_role;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "receptionist inserts feedback for own clinic" ON public.feedback FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND (clinic_id IS NULL OR clinic_id = public.current_clinic_id()));
CREATE POLICY "super admin reads all feedback" ON public.feedback FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));

-- Doctor shift status
CREATE TABLE public.doctor_shift_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('on_time','delayed')),
  delay_minutes INT NOT NULL DEFAULT 0 CHECK (delay_minutes >= 0 AND delay_minutes <= 480),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(doctor_id, shift_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.doctor_shift_status TO authenticated;
GRANT ALL ON public.doctor_shift_status TO service_role;
ALTER TABLE public.doctor_shift_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clinic reads shift status" ON public.doctor_shift_status FOR SELECT TO authenticated USING (clinic_id = public.current_clinic_id());
CREATE POLICY "clinic inserts shift status" ON public.doctor_shift_status FOR INSERT TO authenticated WITH CHECK (clinic_id = public.current_clinic_id());
CREATE POLICY "clinic updates shift status" ON public.doctor_shift_status FOR UPDATE TO authenticated USING (clinic_id = public.current_clinic_id()) WITH CHECK (clinic_id = public.current_clinic_id());

-- Platform notifications
CREATE TABLE public.platform_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  target_date DATE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(clinic_id, kind, target_date)
);
GRANT SELECT, UPDATE ON public.platform_notifications TO authenticated;
GRANT ALL ON public.platform_notifications TO service_role;
ALTER TABLE public.platform_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clinic reads own notifications" ON public.platform_notifications FOR SELECT TO authenticated USING (clinic_id = public.current_clinic_id());
CREATE POLICY "clinic marks own notifications read" ON public.platform_notifications FOR UPDATE TO authenticated USING (clinic_id = public.current_clinic_id()) WITH CHECK (clinic_id = public.current_clinic_id());

-- Deduplicate existing token slot collisions BEFORE unique index
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY clinic_id, doctor_id, appointment_date, appointment_time
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.tokens
  WHERE status <> 'cancelled' AND doctor_id IS NOT NULL AND appointment_time IS NOT NULL
)
UPDATE public.tokens t SET status = 'cancelled'
FROM ranked WHERE t.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS tokens_no_double_booking
  ON public.tokens (clinic_id, doctor_id, appointment_date, appointment_time)
  WHERE status <> 'cancelled' AND doctor_id IS NOT NULL AND appointment_time IS NOT NULL;

-- Drop per-clinic tunnel url
ALTER TABLE public.clinic_settings DROP COLUMN IF EXISTS tunnel_url;

-- Trial default 21 days
ALTER TABLE public.clinics ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '21 days');

-- handle_new_user update
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  new_clinic_id UUID;
  meta_mobile TEXT;
BEGIN
  meta_mobile := NULLIF(NEW.raw_user_meta_data->>'clinic_mobile', '');
  IF meta_mobile IS NOT NULL AND meta_mobile !~ '^[0-9]{10}$' THEN
    meta_mobile := NULL;
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
$$;
