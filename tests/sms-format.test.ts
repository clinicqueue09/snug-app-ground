import { describe, expect, test } from "bun:test";
import { fitSms, joinParts, smsClean, smsDate, smsDoctor, smsTime, SMS_MAX } from "../src/lib/sms-format";

describe("sms format", () => {
  test("cleans special characters to plain ASCII", () => {
    expect(smsClean("a — b – c “q” ‘s’ … x | y ₹é")).toBe("a - b - c \"q\" 's' ... x , y ");
  });
  test("date, time, doctor formats", () => {
    expect(smsDate("2026-11-08")).toBe("Sun 8 Nov");
    expect(smsTime("16:30:00")).toBe("4:30PM");
    expect(smsTime("09:05")).toBe("9:05AM");
    expect(smsDoctor("Dr. Mehta")).toBe("Dr Mehta");
    expect(smsDoctor("")).toBe("");
  });
  test("example confirmation text", () => {
    const out = fitSms(({ first, doctor, clinic }) =>
      `${first}: appt ${joinParts("Sun 8 Nov 4:30PM", doctor, clinic)}. Updates: send Hi https://wa.me/919662277784?text=Hi`,
      { patientName: "Bhavin Shah", doctorName: "Dr Mehta", clinicName: "Sunrise Clinic" });
    expect(out).toBe("Bhavin: appt Sun 8 Nov 4:30PM, Dr Mehta, Sunrise Clinic. Updates: send Hi https://wa.me/919662277784?text=Hi");
  });
  test("long names are shortened to fit, link kept", () => {
    const link = "https://wa.me/919662277784?text=Hi";
    const out = fitSms(({ first, doctor, clinic }) =>
      `${first}: appt ${joinParts("Wed 25 Nov 10:30AM", doctor, clinic)}. Updates: send Hi ${link}`,
      { patientName: "Bhavinkumarxyz Shah", doctorName: "Dr Ramachandranathan", clinicName: "Sunrise Multispeciality Hospital" });
    expect(out.length).toBeLessThanOrEqual(SMS_MAX);
    expect(out.endsWith(link)).toBe(true);
    expect(out).toContain("Wed 25 Nov 10:30AM");
  });
});
