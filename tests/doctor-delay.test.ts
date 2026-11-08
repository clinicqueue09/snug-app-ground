import { describe, it, expect } from "bun:test";
import { nowISTMinutes, tomorrowISTString, inReminderWindow, nextCumulative, delayNotifyDecision, shiftTime, validateDelta } from "../src/lib/doctor-delay";

describe("doctor delay rules", () => {
  it("IST minutes and tomorrow", () => {
    const d = new Date("2026-11-08T15:30:00Z"); // 21:00 IST
    expect(nowISTMinutes(d)).toBe(21 * 60);
    expect(tomorrowISTString(new Date("2026-11-08T19:00:00Z"))).toBe("2026-11-10");
  });
  it("reminder window 21:00-22:59 IST", () => {
    expect(inReminderWindow(new Date("2026-11-08T15:30:00Z"))).toBe(true);
    expect(inReminderWindow(new Date("2026-11-08T17:29:00Z"))).toBe(true);
    expect(inReminderWindow(new Date("2026-11-08T17:30:00Z"))).toBe(false);
    expect(inReminderWindow(new Date("2026-11-08T15:29:00Z"))).toBe(false);
  });
  it("cumulative stays 0-480", () => {
    expect(nextCumulative(20, -25)).toBeNull();
    expect(nextCumulative(470, 15)).toBeNull();
    expect(nextCumulative(20, 5)).toBe(25);
    expect(validateDelta(0)).not.toBeNull();
  });
  it("notifies only at 10+ minutes change", () => {
    expect(delayNotifyDecision(9, 0, 0).notify).toBe(false);
    expect(delayNotifyDecision(10, 0, 0).notify).toBe(true);
    expect(delayNotifyDecision(0, 15, 1).notify).toBe(true);
  });
  it("caps at 6 notifications per day", () => {
    expect(delayNotifyDecision(30, 0, 6)).toEqual({ notify: false, capReached: true });
  });
  it("shiftTime rejects crossing the day", () => {
    expect(shiftTime("23:50", 15)).toBeNull();
    expect(shiftTime("00:05", -10)).toBeNull();
    expect(shiftTime("10:00", 25)).toBe("10:25");
  });
});
