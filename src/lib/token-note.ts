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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** "2026-09-25" -> "FRI, 25th Sept 2026" (Indian style for patient messages). */
export function formatDateIN(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return iso ?? "";
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const wd = DAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  const suf = d % 100 >= 11 && d % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][d % 10] ?? "th";
  return `${wd}, ${d}${suf} ${MONTHS[mo - 1]} ${y}`;
}
