import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type SendInput = {
  phone: string; // 10 digits
  patientName: string;
  doctorName: string;
  appointmentDate: string; // YYYY-MM-DD
  appointmentTime: string | null;
  tokenNumber: number;
  variant?: "confirmation" | "next_in_line";
};

export const sendWhatsAppMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SendInput) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: settings, error: settingsErr } = await supabase
      .from("clinic_settings")
      .select("tunnel_url")
      .maybeSingle();

    if (settingsErr) return { ok: false, error: settingsErr.message };
    const tunnelUrl = settings?.tunnel_url?.trim();
    if (!tunnelUrl) return { ok: false, error: "WhatsApp tunnel URL not configured" };

    const digits = (data.phone || "").replace(/\D/g, "");
    if (digits.length !== 10) return { ok: false, error: "Phone must be exactly 10 digits" };

    const timeStr = data.appointmentTime ? ` at ${data.appointmentTime}` : "";
    const message =
      data.variant === "next_in_line"
        ? `Hello ${data.patientName}, you are next in line for Dr. ${data.doctorName}. Your Token is ${data.tokenNumber}. Please be ready.`
        : `Hello ${data.patientName}, your appointment with Dr. ${data.doctorName} is confirmed for ${data.appointmentDate}${timeStr}. Your Token is ${data.tokenNumber}.`;

    const payload = { phone: `91${digits}`, message };
    const endpoint = tunnelUrl.replace(/\/+$/, "") + "/send-message";

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Bypass-Tunnel-Reminder": "true",
        },
        body: JSON.stringify(payload),
      });
      return { ok: res.ok, status: res.status };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
    }
  });
