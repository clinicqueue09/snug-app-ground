export type WorkSession = { start_time: string; end_time: string };
export type AvailabilityRow = WorkSession & { weekday: number };
export type AppointmentSlotRow = {
  id: string;
  appointment_time: string | null;
  status: string;
};
export type AvailabilityDraft = {
  days: number[];
  session1: WorkSession;
  session2?: WorkSession;
};

export const DEFAULT_WORK_SESSIONS: WorkSession[] = [
  { start_time: "09:00", end_time: "13:00" },
  { start_time: "17:00", end_time: "21:00" },
];

export function clampSlotLength(doctorValue: number | null | undefined, clinicValue: number | null | undefined) {
  const value = doctorValue ?? clinicValue ?? 10;
  return Math.min(60, Math.max(5, value));
}

export function sessionsForWeekday(weekday: number, availability: AvailabilityRow[]): WorkSession[] {
  if (availability.length === 0) {
    return weekday === 0 ? [] : DEFAULT_WORK_SESSIONS;
  }
  return availability
    .filter((row) => row.weekday === weekday)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
    .map(({ start_time, end_time }) => ({ start_time, end_time }));
}

export function makeSlotTimes(sessions: WorkSession[], slotLength: number, earliestMinute?: number): string[] {
  const length = clampSlotLength(slotLength, undefined);
  const result: string[] = [];
  for (const session of sessions) {
    const [startHour, startMin] = session.start_time.split(":").map(Number);
    const [endHour, endMin] = session.end_time.split(":").map(Number);
    const start = startHour * 60 + startMin;
    const end = endHour * 60 + endMin;
    for (let minute = start; minute + length <= end; minute += length) {
      if (earliestMinute !== undefined && minute < earliestMinute) continue;
      result.push(`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
    }
  }
  return result;
}

export function isSlotBooked(
  slotStart: string,
  appointments: AppointmentSlotRow[],
  slotLength: number,
  excludeTokenId?: string,
): boolean {
  const [hour, minute] = slotStart.split(":").map(Number);
  const start = hour * 60 + minute;
  const end = start + clampSlotLength(slotLength, undefined);
  return appointments.some((appointment) => {
    if (appointment.status === "cancelled" || appointment.id === excludeTokenId || !appointment.appointment_time) {
      return false;
    }
    const [appointmentHour, appointmentMinute] = appointment.appointment_time.split(":").map(Number);
    const appointmentStart = appointmentHour * 60 + appointmentMinute;
    return appointmentStart >= start && appointmentStart < end;
  });
}

export function validateAvailabilityDraft(draft: AvailabilityDraft): string | null {
  if (draft.days.length === 0) return "Select at least one working day.";
  const validTime = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  if (!validTime(draft.session1.start_time) || !validTime(draft.session1.end_time)) {
    return "Enter valid start and end times for Session 1.";
  }
  if (draft.session1.end_time <= draft.session1.start_time) return "Session 1 must end after it starts.";
  if (draft.session2) {
    if (!validTime(draft.session2.start_time) || !validTime(draft.session2.end_time)) {
      return "Enter valid start and end times for Session 2.";
    }
    if (draft.session2.end_time <= draft.session2.start_time) return "Session 2 must end after it starts.";
    if (draft.session2.start_time <= draft.session1.end_time) {
      return "Session 2 must start after Session 1 ends.";
    }
  }
  return null;
}
/** Returns the slot start (HH:MM) that contains the given appointment time, or null. */
export function slotForTime(time: string | null, slots: string[], slotLength: number): string | null {
  if (!time) return null;
  const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const value = toMin(time);
  const length = clampSlotLength(slotLength, undefined);
  return slots.find((slot) => value >= toMin(slot) && value < toMin(slot) + length) ?? null;
}

/** Masks a phone like 9876543321 -> "98••• ••321". */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "").slice(-10);
  if (digits.length < 5) return digits;
  return `${digits.slice(0, 2)}••• ••${digits.slice(-3)}`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
