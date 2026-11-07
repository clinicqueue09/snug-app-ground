import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatDisplay } from "@/components/TimeSelect";
import {
  clampSlotLength,
  isSlotBooked,
  makeSlotTimes,
  sessionsForWeekday,
  type AppointmentSlotRow,
  type AvailabilityRow,
} from "@/lib/scheduling";

type SelectedSlot = { date: string; time: string };
type DayInfo = { date: Date; key: string; slots: string[]; free: string[]; state: "leave" | "off" | "full" | "plenty" | "few" };

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function formatTime12(time: string) {
  return formatDisplay(time);
}

export function SlotPicker({
  clinicId,
  doctorId,
  clinicDuration,
  doctorDuration,
  value,
  onChange,
  excludeTokenId,
  refreshSignal = 0,
}: {
  clinicId: string;
  doctorId: string;
  clinicDuration?: number;
  doctorDuration?: number | null;
  value: SelectedSlot | null;
  onChange: (value: SelectedSlot | null) => void;
  excludeTokenId?: string;
  refreshSignal?: number;
}) {
  const [availability, setAvailability] = useState<AvailabilityRow[]>([]);
  const [daysOff, setDaysOff] = useState<Set<string>>(new Set());
  const [appointments, setAppointments] = useState<Record<string, AppointmentSlotRow[]>>({});
  const [savedClinicDuration, setSavedClinicDuration] = useState<number | null>(clinicDuration ?? null);
  const [savedDoctorDuration, setSavedDoctorDuration] = useState<number | null>(doctorDuration ?? null);
  const [selectedDate, setSelectedDate] = useState(value?.date ?? localDateKey(startOfToday()));
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());

  const days = useMemo(() => {
    const today = startOfToday();
    return Array.from({ length: 31 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() + index);
      return { date, key: localDateKey(date) };
    });
  }, []);

  const loadSchedule = useCallback(async (showErrors = false) => {
    setLoading(true);
    const firstDate = localDateKey(startOfToday());
    const last = new Date();
    last.setHours(0, 0, 0, 0);
    last.setDate(last.getDate() + 30);
    const lastDate = localDateKey(last);
    const [availabilityResult, timeOffResult, tokensResult, clinicResult, doctorResult] = await Promise.all([
      supabase
        .from("doctor_availability")
        .select("weekday,start_time,end_time")
        .eq("doctor_id", doctorId)
        .eq("clinic_id", clinicId),
      supabase
        .from("doctor_time_off")
        .select("off_date")
        .eq("doctor_id", doctorId)
        .eq("clinic_id", clinicId)
        .gte("off_date", firstDate)
        .lte("off_date", lastDate),
      supabase
        .from("tokens")
        .select("id,appointment_date,appointment_time,status")
        .eq("clinic_id", clinicId)
        .eq("clinic_id", clinicId)
        .eq("doctor_id", doctorId)
        .gte("appointment_date", firstDate)
        .lte("appointment_date", lastDate)
        .neq("status", "cancelled"),
      clinicDuration == null
        ? supabase.from("clinics").select("avg_time_per_patient").eq("id", clinicId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      doctorDuration === undefined
        ? supabase.from("doctors").select("avg_time_per_patient").eq("id", doctorId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    const failed = availabilityResult.error ?? timeOffResult.error ?? tokensResult.error ?? clinicResult.error ?? doctorResult.error;
    if (failed) {
      if (showErrors) toast.error(`Could not load available appointments: ${failed.message}`);
      setLoading(false);
      return;
    }
    setAvailability((availabilityResult.data ?? []) as AvailabilityRow[]);
    setDaysOff(new Set((timeOffResult.data ?? []).map((row) => row.off_date)));
    if (clinicDuration == null) setSavedClinicDuration(clinicResult.data?.avg_time_per_patient ?? 10);
    if (doctorDuration === undefined) setSavedDoctorDuration(doctorResult.data?.avg_time_per_patient ?? null);
    const grouped: Record<string, AppointmentSlotRow[]> = {};
    for (const row of tokensResult.data ?? []) {
      const dateKey = row.appointment_date;
      (grouped[dateKey] ??= []).push(row as AppointmentSlotRow);
    }
    setAppointments(grouped);
    setNow(new Date());
    setLoading(false);
  }, [clinicId, doctorId, clinicDuration, doctorDuration]);

  useEffect(() => {
    void loadSchedule(true);
    const interval = setInterval(() => void loadSchedule(false), 45_000);
    return () => clearInterval(interval);
  }, [loadSchedule, refreshSignal]);

  useEffect(() => {
    if (value?.date) setSelectedDate(value.date);
  }, [value?.date]);

  const slotLength = clampSlotLength(doctorDuration ?? savedDoctorDuration, clinicDuration ?? savedClinicDuration ?? 10);
  const dayInfos = useMemo<DayInfo[]>(() => days.map(({ date, key }) => {
    if (daysOff.has(key)) return { date, key, slots: [], free: [], state: "leave" };
    const sessions = sessionsForWeekday(date.getDay(), availability);
    if (sessions.length === 0) return { date, key, slots: [], free: [], state: "off" };
    const todayMinute = date.toDateString() === now.toDateString()
      ? now.getHours() * 60 + now.getMinutes() + (now.getSeconds() > 0 || now.getMilliseconds() > 0 ? 1 : 0)
      : undefined;
    const slots = makeSlotTimes(sessions, slotLength, todayMinute);
    if (slots.length === 0) return { date, key, slots, free: [], state: "full" };
    const bookedForDate = appointments[key] ?? [];
    const free = slots.filter((slot) => !isSlotBooked(slot, bookedForDate, slotLength, excludeTokenId));
    return {
      date,
      key,
      slots,
      free,
      state: free.length === 0 ? "full" : free.length <= 3 ? "few" : "plenty",
    };
  }), [days, daysOff, availability, now, slotLength, appointments, excludeTokenId]);

  const chosenDay = dayInfos.find((day) => day.key === selectedDate) ?? dayInfos[0];
  const firstFree = dayInfos.find((day) => day.free.length > 0);

  const selectSlot = (date: string, time: string) => {
    setSelectedDate(date);
    onChange({ date, time });
  };

  const pickEarliest = () => {
    if (!firstFree) {
      toast.message("No free appointment slots in the next 30 days.");
      return;
    }
    selectSlot(firstFree.key, firstFree.free[0]);
  };

  const pickWalkIn = () => {
    const todayKey = localDateKey(startOfToday());
    if (daysOff.has(todayKey)) {
      toast.message("This doctor is on leave today.");
      return;
    }
    const today = dayInfos.find((day) => day.key === todayKey);
    if (!today?.free.length) {
      toast.message("No free slots left today.");
      return;
    }
    selectSlot(today.key, today.free[0]);
  };

  const groups = [
    { label: "Morning", slots: chosenDay?.slots.filter((time) => Number(time.slice(0, 2)) < 12) ?? [] },
    { label: "Afternoon", slots: chosenDay?.slots.filter((time) => Number(time.slice(0, 2)) >= 12 && Number(time.slice(0, 2)) < 17) ?? [] },
    { label: "Evening", slots: chosenDay?.slots.filter((time) => Number(time.slice(0, 2)) >= 17) ?? [] },
  ];
  const noSavedSchedule = availability.length === 0;

  return (
    <div className="space-y-3" aria-busy={loading}>
      {noSavedSchedule && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No working hours saved, default hours shown. Set them under Doctors.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="button" variant="outline" onClick={pickEarliest} disabled={loading || !firstFree}>
          Earliest free: {firstFree ? `${firstFree.key === localDateKey(startOfToday()) ? "Today" : format(firstFree.date, "MMM d")}, ${formatTime12(firstFree.free[0])}` : "—"}
        </Button>
        <Button size="sm" type="button" variant="outline" onClick={pickWalkIn} disabled={loading}>
          Walk-in now
        </Button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2" aria-label="Choose appointment date">
        {dayInfos.map((day) => {
          const isSelected = selectedDate === day.key;
          const style = day.state === "plenty"
            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
            : day.state === "few"
              ? "border-amber-300 bg-amber-50 text-amber-800"
              : day.state === "full"
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : "border-muted bg-muted/60 text-muted-foreground";
          const note = day.state === "plenty" ? `${day.free.length} free`
            : day.state === "few" ? `${day.free.length} left`
              : day.state === "full" ? "Full"
                : day.state === "leave" ? "Leave" : "Off";
          return (
            <button
              key={day.key}
              type="button"
              disabled={day.state === "leave" || day.state === "off" || day.state === "full"}
              onClick={() => {
                setSelectedDate(day.key);
                if (value?.date !== day.key) onChange(null);
              }}
              aria-pressed={isSelected}
              className={`flex h-[88px] w-[72px] shrink-0 flex-col items-center justify-center gap-1 rounded-md border text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-80 ${style} ${isSelected ? "ring-2 ring-primary ring-offset-1" : ""}`}
            >
              <span className="font-medium">{format(day.date, "EEE")}</span>
              <span className="text-lg font-semibold leading-none">{format(day.date, "d")}</span>
              <span>{note}</span>
            </button>
          );
        })}
      </div>
      {chosenDay && (
        <div className="space-y-3">
          {groups.map((group) => group.slots.length > 0 && (
            <section key={group.label} className="space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground">{group.label}</h4>
              <div className="grid grid-cols-4 gap-2">
                {group.slots.map((time) => {
                  const booked = isSlotBooked(time, appointments[chosenDay.key] ?? [], slotLength, excludeTokenId);
                  const selected = value?.date === chosenDay.key && value.time === time;
                  return (
                    <Button
                      key={time}
                      type="button"
                      size="sm"
                      variant={selected ? "default" : "outline"}
                      disabled={booked || loading}
                      onClick={() => selectSlot(chosenDay.key, time)}
                      className={`h-9 text-xs ${booked ? "text-muted-foreground line-through opacity-60" : ""} ${selected ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}`}
                    >
                      {formatTime12(time)}
                    </Button>
                  );
                })}
              </div>
            </section>
          ))}
          {chosenDay.state === "leave" && <p className="text-sm text-muted-foreground">Doctor is on leave.</p>}
          {(chosenDay.state === "off" || chosenDay.state === "full") && <p className="text-sm text-muted-foreground">No available times for this day.</p>}
          <p className="text-xs font-medium text-foreground">
            Selected: {value?.date === chosenDay.key ? `${format(chosenDay.date, "EEE, MMM d")}, ${formatTime12(value.time)}` : "Choose a time"}
          </p>
        </div>
      )}
    </div>
  );
}