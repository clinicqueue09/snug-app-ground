/** yyyy-MM-dd in Asia/Kolkata, independent of server timezone. */
export function todayISTString(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Token note for confirmation/rescheduled messages. Future dates never show a number. */
export function tokenNoteFor(
  appointmentDate: string,
  rank: number | null,
  channel: "whatsapp" | "sms",
  today: string = todayISTString(),
): string {
  if (appointmentDate === today && rank != null) {
    return channel === "sms"
      ? `Token today: #${rank}.`
      : `Your token today: #${rank} (may change if earlier slots are booked)`;
  }
  return channel === "sms"
    ? "Token no. will be sent on the day of your visit."
    : "Your token number will be sent on the day of your visit.";
}
