import { describe, expect, test } from "bun:test";
import {
  clampSlotLength,
  isSlotBooked,
  makeSlotTimes,
  sessionsForWeekday,
  validateAvailabilityDraft,
} from "../src/lib/scheduling";

describe("appointment scheduling rules", () => {
  test("uses doctor duration, clinic default, then ten minutes, clamped to five through sixty", () => {
    expect(clampSlotLength(20, 15)).toBe(20);
    expect(clampSlotLength(null, 15)).toBe(15);
    expect(clampSlotLength(undefined, null)).toBe(10);
    expect(clampSlotLength(4, 10)).toBe(5);
    expect(clampSlotLength(90, 10)).toBe(60);
  });

  test("generates only complete slots from each session start", () => {
    expect(makeSlotTimes([{ start_time: "09:00", end_time: "10:00" }], 20)).toEqual([
      "09:00", "09:20", "09:40",
    ]);
    expect(makeSlotTimes([{ start_time: "09:00", end_time: "09:19" }], 20)).toEqual([]);
  });

  test("uses Monday through Saturday default sessions when no schedule is saved", () => {
    expect(sessionsForWeekday(1, [])).toEqual([
      { start_time: "09:00", end_time: "13:00" },
      { start_time: "17:00", end_time: "21:00" },
    ]);
    expect(sessionsForWeekday(0, [])).toEqual([]);
  });

  test("marks a slot booked for a non-cancelled appointment in its half-open interval", () => {
    const appointments = [
      { id: "cancelled", appointment_time: "09:05", status: "cancelled" },
      { id: "booked", appointment_time: "09:19", status: "waiting" },
      { id: "next", appointment_time: "09:20", status: "waiting" },
    ];
    expect(isSlotBooked("09:00", appointments, 20)).toBe(true);
    expect(isSlotBooked("09:00", appointments, 20, "booked")).toBe(false);
    expect(isSlotBooked("09:20", appointments, 20)).toBe(true);
  });

  test("requires a working day and non-overlapping ordered sessions", () => {
    const session1 = { start_time: "09:00", end_time: "13:00" };
    expect(validateAvailabilityDraft({ days: [], session1 })).toBe("Select at least one working day.");
    expect(validateAvailabilityDraft({ days: [1], session1: { start_time: "13:00", end_time: "09:00" } }))
      .toBe("Session 1 must end after it starts.");
    expect(validateAvailabilityDraft({ days: [1], session1: { start_time: "", end_time: "13:00" } }))
      .toBe("Enter valid start and end times for Session 1.");
    expect(validateAvailabilityDraft({ days: [1], session1, session2: { start_time: "17:00", end_time: "17:00" } }))
      .toBe("Session 2 must end after it starts.");
    expect(validateAvailabilityDraft({ days: [1], session1, session2: { start_time: "12:00", end_time: "17:00" } }))
      .toBe("Session 2 must start after Session 1 ends.");
    expect(validateAvailabilityDraft({ days: [1], session1, session2: { start_time: "13:00", end_time: "17:00" } }))
      .toBe("Session 2 must start after Session 1 ends.");
    expect(validateAvailabilityDraft({ days: [1], session1, session2: { start_time: "17:00", end_time: "21:00" } }))
      .toBeNull();
  });
});
import { slotForTime, maskPhone, escapeHtml } from "../src/lib/scheduling";
describe("day schedule helpers", () => {
  it("places a booking in the slot that contains it", () => {
    expect(slotForTime("10:15", ["10:00", "10:10", "10:20"], 10)).toBe("10:10");
    expect(slotForTime("14:00", ["10:00", "10:10"], 10)).toBeNull();
  });
  it("masks phones as 98••• ••321", () => {
    expect(maskPhone("9812345321")).toBe("98••• ••321");
  });
  it("escapes patient text for print", () => {
    expect(escapeHtml(`<b>"A&B"</b>`)).toBe("&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;");
  });
});
