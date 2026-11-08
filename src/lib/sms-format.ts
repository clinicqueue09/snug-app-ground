/** Short, plain-ASCII SMS helpers (SMS route bills per 70 chars; one non-ASCII char switches encoding). */

export const SMS_MAX = 134;

export function smsClean(text: string): string {
  return text
    .replace(/[\u2014\u2013\u2012\u2015]/g, "-")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\|/g, ",")
    .replace(/[^\x00-\x7F]/g, "");
}

const cut = (s: string, n: number) => s.slice(0, n).trim();

export function smsFirstName(name: string | null | undefined, max = 10): string {
  const first = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  return cut(first, max);
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** yyyy-MM-dd (already an India calendar date) -> "Sun 8 Nov". */
export function smsDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "HH:MM[:SS]" or "4:30 PM" -> "4:30PM". */
export function smsTime(t: string | null | undefined): string {
  const s = String(t ?? "").trim();
  if (!s) return "";
  const ampm = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/.exec(s);
  if (ampm) return `${+ampm[1]}:${ampm[2]}${ampm[3].toUpperCase()}`;
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (!m) return "";
  const h = +m[1];
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]}${h < 12 ? "AM" : "PM"}`;
}

export function smsDoctor(name: string | null | undefined, max = 14): string {
  const bare = String(name ?? "").trim().replace(/^dr\.?\s*/i, "").trim();
  if (!bare) return "";
  return cut(`Dr ${bare}`, max);
}

export function smsClinic(name: string | null | undefined, max = 18): string {
  return cut(String(name ?? "").trim(), max);
}

export type SmsParts = { first: string; doctor: string; clinic: string };

/** Build, then shorten clinic -> 12, doctor -> 8, first -> 6 until <= SMS_MAX. */
export function fitSms(
  build: (p: SmsParts) => string,
  raw: { patientName?: string | null; doctorName?: string | null; clinicName?: string | null },
): string {
  const steps: Array<[number, number, number]> = [
    [10, 14, 18],
    [10, 14, 12],
    [10, 8, 12],
    [6, 8, 12],
  ];
  let out = "";
  for (const [f, d, c] of steps) {
    out = smsClean(build({
      first: smsFirstName(raw.patientName, f),
      doctor: smsDoctor(raw.doctorName, d),
      clinic: smsClinic(raw.clinicName, c),
    }));
    if (out.length <= SMS_MAX) break;
  }
  return out;
}

/** Join non-empty parts with ", ". */
export const joinParts = (...parts: Array<string | null | undefined>) =>
  parts.map((p) => String(p ?? "").trim()).filter(Boolean).join(", ");
