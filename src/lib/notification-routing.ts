/** Recognition is clinic-scoped and is not a claim of WhatsApp opt-in consent. */
export function normalizePatientPhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

export function hasPreviousAppointment(
  phone: string,
  appointments: Array<{ phone_number: string }>,
): boolean {
  const normalized = normalizePatientPhone(phone);
  return appointments.some((appointment) => normalizePatientPhone(appointment.phone_number) === normalized);
}

export function notificationChannel(input: {
  connected: boolean;
  optedIn: boolean;
  previousAppointment: boolean;
  messagesSent: number;
}): "sms" | "whatsapp" {
  return input.connected && (input.optedIn || input.previousAppointment || input.messagesSent > 0)
    ? "whatsapp"
    : "sms";
}