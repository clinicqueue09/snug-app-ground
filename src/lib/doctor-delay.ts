/** Minutes since midnight in Asia/Kolkata. */
export function nowISTMinutes(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/** Tomorrow's yyyy-MM-dd in Asia/Kolkata. */
export function tomorrowISTString(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(now.getTime() + 24 * 3600_000));
}

/** 21:00–22:59 IST. */
export function inReminderWindow(now: Date = new Date()): boolean {
  const m = nowISTMinutes(now);
  return m >= 21 * 60 && m <= 22 * 60 + 59;
}

export const MAX_DELAY = 480;
export const NOTIFY_THRESHOLD = 10;
export const MAX_DELAY_NOTIFICATIONS = 6;

export function validateDelta(delta: number): string | null {
  if (!Number.isInteger(delta) || delta === 0 || delta < -MAX_DELAY || delta > MAX_DELAY) {
    return "Delay change must be a whole number between -480 and 480 (not 0).";
  }
  return null;
}

export function nextCumulative(cur: number, delta: number): number | null {
  const n = cur + delta;
  return n < 0 || n > MAX_DELAY ? null : n;
}

/** Decide whether to notify patients. */
export function delayNotifyDecision(newCum: number, notified: number, notifyCount: number) {
  const pending = Math.abs(newCum - notified);
  if (pending < NOTIFY_THRESHOLD) return { notify: false, capReached: false };
  if (notifyCount >= MAX_DELAY_NOTIFICATIONS) return { notify: false, capReached: true };
  return { notify: true, capReached: false };
}

/** Shift "HH:mm" by delta minutes; null when it leaves the same day. */
export function shiftTime(time: string, delta: number): string | null {
  const [h, m] = time.split(":").map(Number);
  const t = h * 60 + m + delta;
  if (t < 0 || t > 23 * 60 + 59) return null;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
