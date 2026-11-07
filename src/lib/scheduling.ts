export type WorkSession = { start_time: string; end_time: string };
export type AvailabilityRow = WorkSession & { weekday: number };
export type AppointmentSlotRow = {
  id: string;
  appointment_time: string | null;
  status: string;
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