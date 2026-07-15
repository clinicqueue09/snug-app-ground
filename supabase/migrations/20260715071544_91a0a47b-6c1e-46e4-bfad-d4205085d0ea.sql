
UPDATE public.doctors SET specialty = 'General' WHERE specialty IS NULL OR specialty = '';
ALTER TABLE public.doctors ALTER COLUMN specialty SET NOT NULL;
ALTER TABLE public.doctors ADD COLUMN IF NOT EXISTS avg_time_per_patient INT NULL CHECK (avg_time_per_patient IS NULL OR (avg_time_per_patient >= 1 AND avg_time_per_patient <= 240));
