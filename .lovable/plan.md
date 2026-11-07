# Doctor schedules and visual appointment slots

Add per-doctor working hours, selectable appointment durations, and a slot picker for bookings and rescheduling. The existing `doctor_availability` and `doctor_time_off` tables will be used; no database changes are planned.

## Changes
- Add a collapsible working-hours editor to each doctor in Manage Doctors, including weekday selection, one or two shared daily sessions, validation, and safe save ordering. Include a “Use default hours” reset that removes the saved schedule.
- Replace average-time text fields with dropdowns for 5, 10, 15, 20, and 30 minutes, plus any existing saved value; doctor controls also include “Clinic default” (null).
- Build a visual 31-day slot picker that loads availability, leave, and bookings, refreshes every 45 seconds, marks free/full/off/leave days, and offers “Earliest free” and “Walk-in now” actions.
- Use the picker for doctor-specific patient booking and rescheduling; preserve the existing date/time controls when a token has no doctor. Exclude a rescheduled token from its own booked-slot calculation.
- Keep the existing patient validation and confirmation notification. If a booking loses a race to another booking, clear the selection, refresh available slots, and show the requested message.

## Scheduling rules
- Use saved sessions when present; otherwise show the specified Monday–Saturday default sessions and the amber notice. Treat doctor time-off dates as unavailable.
- Choose slot length from doctor duration, clinic default, then 10 minutes; clamp to 5–60. Generate slots within each session and consider a slot occupied when a non-cancelled appointment starts within its interval.
- Hide past slots for today. Display day cards and 12-hour time chips grouped by morning, afternoon, and evening; disable booked or unavailable choices.

## Technical details
- Keep all changes within the dashboard scheduling UI and focused picker/editor components. Use the existing Supabase client and UI controls; add no columns or behavior outside this scheduling request.
- Validate editor data before writing. Insert replacement availability rows before deleting previous rows so an insert failure preserves the saved schedule.
- Verify the booking, schedule-edit, and reschedule paths in the preview and check the latest build signal.