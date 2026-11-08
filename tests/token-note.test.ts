import { describe, it, expect } from "bun:test";
import { todayISTString, tokenNoteFor } from "../src/lib/token-note";

describe("todayISTString", () => {
  it("rolls to the next day in India after 18:30 UTC", () => {
    expect(todayISTString(new Date("2026-11-07T18:31:00Z"))).toBe("2026-11-08");
  });
  it("stays on the same day before 18:30 UTC", () => {
    expect(todayISTString(new Date("2026-11-07T18:29:00Z"))).toBe("2026-11-07");
  });
});

describe("tokenNoteFor", () => {
  it("shows today's rank on the visit day", () => {
    expect(tokenNoteFor("2026-11-07", 3, "sms", "2026-11-07")).toBe("Token today: #3.");
    expect(tokenNoteFor("2026-11-07", 3, "whatsapp", "2026-11-07")).toContain("#3");
  });
  it("hides the number for a future date", () => {
    expect(tokenNoteFor("2026-11-08", 3, "sms", "2026-11-07")).toBe("Token no. will be sent on the day of your visit.");
  });
});

import { formatDateIN } from "../src/lib/token-note";
test("Indian date format with weekday", () => {
  expect(formatDateIN("2026-09-25")).toBe("FRI, 25th Sept 2026");
  expect(formatDateIN("2026-11-01")).toBe("SUN, 1st Nov 2026");
  expect(formatDateIN("2026-11-12")).toBe("THU, 12th Nov 2026");
  expect(formatDateIN("2026-11-22")).toBe("SUN, 22nd Nov 2026");
});
