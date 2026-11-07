import { describe, expect, test } from "bun:test";
import { hasPreviousAppointment, notificationChannel } from "../src/lib/notification-routing";

const newPatient = { connected: true, optedIn: false, previousAppointment: false, messagesSent: 0 };

describe("patient notification routing", () => {
  test("sends the first notification for a new patient via SMS", () => {
    expect(notificationChannel(newPatient)).toBe("sms");
  });

  test("sends subsequent notifications after the first successful SMS via WhatsApp", () => {
    expect(notificationChannel({ ...newPatient, messagesSent: 1 })).toBe("whatsapp");
  });

  test("sends returning patients' notifications via WhatsApp without an opt-in row", () => {
    expect(notificationChannel({ ...newPatient, previousAppointment: true })).toBe("whatsapp");
  });

  test("preserves explicit opt-in routing", () => {
    expect(notificationChannel({ ...newPatient, optedIn: true })).toBe("whatsapp");
  });

  test("uses SMS when the clinic is disconnected", () => {
    expect(notificationChannel({ ...newPatient, connected: false, previousAppointment: true, messagesSent: 1, optedIn: true })).toBe("sms");
  });

  test("recognizes the same phone across country-code and formatting variants", () => {
    expect(hasPreviousAppointment("9876543210", [{ phone_number: "+91 98765 43210" }])).toBe(true);
    expect(hasPreviousAppointment("919876543210", [{ phone_number: "9876543210" }])).toBe(true);
    expect(hasPreviousAppointment("9876543210", [{ phone_number: "9876543211" }])).toBe(false);
    expect(hasPreviousAppointment("9876543210", [])).toBe(false);
  });
});