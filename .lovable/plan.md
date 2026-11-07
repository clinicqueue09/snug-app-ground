# Add doctor schedules and time off

The database check found neither `doctor_availability` nor `doctor_time_off` currently exists.

## Plan
- Apply one migration that creates only these two tables, their indexes, and clinic-scoped policies, using the uploaded SQL's fields and validation rules.
- Grant authenticated access and service-role access before enabling RLS and adding policies; grant no access to `anon`.
- Leave all existing tables, policies, and application code unchanged.
- Verify both tables exist, RLS is enabled, `anon` has no table privileges, and `authenticated` has SELECT/INSERT/UPDATE/DELETE privileges.

## Technical details
- `doctor_availability` stores weekday sessions with validated 24-hour time strings and an end-after-start rule.
- `doctor_time_off` stores one day-off record per doctor and date.
- Read and write policies scope records to the signed-in receptionist's clinic and validate doctor/clinic matching on writes.